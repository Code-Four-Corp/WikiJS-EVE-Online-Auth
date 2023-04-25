const _ = require('lodash')
/* global WIKI */

// ------------------------------------
// EveOnline Account
// ------------------------------------

const OAuth2Strategy = require('passport-oauth2').Strategy
var jwt = require('jsonwebtoken');

const markupRegex = /(<[^>]*>)*(?<name>[^<]+)(<[^>]*>)*/i;
const getStringWithoutFormatting = (formattedString) => {
  const match = markupRegex.exec(formattedString);

  if(!match) return null

  return match.groups.name
}

const getRoles = async ({ profile, accessToken }) => {
  const response = await fetch(`https://esi.evetech.net/latest/characters/${profile.id}/roles/`, {
    headers: new Headers({
      'Authorization': `Bearer ${accessToken}`
    }),
    credentials: 'include'
  });

  const data = await response?.json();

  let roles = data?.roles;

  if (roles && _.isArray(roles)) {
    roles = roles
    .map(f => f.toLowerCase().trim().replace(/_/g, " "))
    .map(getStringWithoutFormatting)
    .filter(f => f);
  }

  return roles || [];
}

const getTitles = async ({ profile, accessToken }) => {
  const response = await fetch(`https://esi.evetech.net/latest/characters/${profile.id}/titles/`, {
    headers: new Headers({
      'Authorization': `Bearer ${accessToken}`
    }),
    credentials: 'include'
  });

  let data = await response?.json();

  if (data && _.isArray(data)) {
    data = data
      .map(f => f.name.toLowerCase().trim().replace(/_/g, " "))
      .map(getStringWithoutFormatting)
      .filter(f => f);
  }

  return data || [];
}

const getCharacterInfo = async ({ profile }) => {
  const response = await fetch(`https://esi.evetech.net/latest/characters/${profile.id}/`);
  return await response?.json();
}

const addGroup = async ({ user, groupId, allGroups }) => {
  const group = allGroups.find(f => f.id === groupId);

  if (!group) {
    WIKI.logger.warn(`Could not find group to add: ${groupId}`);

    return;
  }

  await user.$relatedQuery('groups').relate(groupId);

  WIKI.logger.info(`Added group: ${group.name} (${groupId})`);
}

const removeGroup = async ({ user, groupId, allGroups, keywordBlacklist }) => {
  const group = allGroups.find(f => f.id === groupId);

  if (!group) {
    WIKI.logger.warn(`Could not find group to remove: ${groupId}`);

    return;
  }

  // If the unexpected group is a manually-assigned
  // one, then don't remove it.
  for (const keyword in keywordBlacklist) {
    if (group.name.toLowerCase().includes(keyword)) {
      WIKI.logger.info(`Ignored group: ${group.name} (${groupId})`);
      return;
    }
  }

  await user.$relatedQuery('groups').unrelate().where('groupId', groupId);

  WIKI.logger.info(`Removed group: ${group.name} (${groupId})`);
}

module.exports = {
  init(passport, conf) {
    var client = new OAuth2Strategy({
      authorizationURL: 'https://login.eveonline.com/v2/oauth/authorize/?response_type=code',
      tokenURL: 'https://login.eveonline.com/v2/oauth/token',
      clientID: conf.clientId,
      clientSecret: conf.clientSecret,
      callbackURL: conf.callbackURL,
      passReqToCallback: true,
      state: true,
      scope: conf.scope
    },
    async (req, accessToken, refreshToken, profile, cb) => {
      try {
        const user = await WIKI.models.users.processProfile({
          providerKey: req.params.strategy,
          profile
        })

        const useAutoRoles = conf.useAutoRoles;

        const allianceIds = conf.allianceIds;
        const corpIds = conf.corpIds;
        const corpIdsArray = corpIds?.split(",")?.map(f => f.trim());
        const allianceIdsArray = allianceIds?.split(",")?.map(f => f.trim());

        if (!allianceIdsArray?.length && !corpIdsArray?.length)
          return cb(null, user);

        const keywordBlacklist = conf.keywordBlacklist?.split(",")?.map(f => f.toLowerCase().trim()) || [];
        const memberGroupNames = conf.corpMemberGroupNames?.split(",")?.map(f => f.toLowerCase().trim()) || [];

        // Get the character and corporation info.
        const characterData = await getCharacterInfo({ profile });

        const isCorpMember = corpIdsArray.includes(`${characterData?.corporation_id}`);
        const isAllianceMember = allianceIdsArray.includes(`${characterData?.alliance_id}`);

        WIKI.logger.info(isCorpMember ? 'Is corp member' : `Is not corp member (${characterData?.corporation_id})`);
        WIKI.logger.info(isAllianceMember ? 'Is alliance member' : `Is not alliance member (${characterData?.alliance_id})`);

        const allGroups = Object.values(WIKI.auth.groups);
        const memberGroups = allGroups.filter(f => memberGroupNames.includes(f.name.trim().toLowerCase()));

        if (!isCorpMember && !isAllianceMember) {
          await Promise.all(memberGroups.map(f => removeGroup({ user, allGroups, groupId: f, keywordBlacklist })));
          
          return cb(null, user);
        }

        // Get the characters's corp roles and titles.
        const [roles, titles, currentGroupsRaw] = await Promise.all([
          useAutoRoles ? getRoles({ profile, accessToken }) : [],
          useAutoRoles ? getTitles({ profile, accessToken }) : [],
          user.$relatedQuery('groups').select('groups.id'),
        ]);

        const rolesAndTitles = [
          ...roles,
          ...titles,
        ];

        if(useAutoRoles)
          WIKI.logger.info(`Roles and titles: ${JSON.stringify(rolesAndTitles)}`);

        const currentGroups = currentGroupsRaw.map(g => g.id);

        let expectedGroups = allGroups
          .filter(g => rolesAndTitles.includes(g.name.toLowerCase().trim()))
          .map(g => g.id);

        // Anyone who is in any of the member corps should
        // get the "Member" group automatically.
        expectedGroups = [
          ...expectedGroups,
          ...memberGroups.map(f => f.id),
        ];

        const groupsToAdd = _.difference(expectedGroups, currentGroups);
        const groupsToRemove = useAutoRoles ? _.difference(currentGroups, expectedGroups) : [];

        await Promise.all([
          ...groupsToAdd.map(f => addGroup({ user, allGroups, groupId: f })),
          ...groupsToRemove.map(f => removeGroup({ user, allGroups, groupId: f, keywordBlacklist })),
        ]);

        cb(null, user);
      } catch (err) {
        cb(err, null);
      }
    });

    OAuth2Strategy.prototype.userProfile = function (accessToken, done) {
      try {
        const payload = jwt.decode(accessToken);

        const sub = payload.sub;
        const subTokens = sub.split(":");
        const characterId = subTokens[2];

        const characterName = payload.name;

        WIKI.logger.info(`Authenticating '${payload.name}' (${characterId})`);

        done(null, {
          id: characterId,
          displayName: characterName,
          email: characterId + '@auth.eveonline.com',
        });
      } catch (err) {
        WIKI.logger.warn('Eve Online - Failed to parse user profile.');
        done(err);
      }
    }

    passport.use(conf.key, client);
  },

  logout(conf) {
    if (!conf.logoutURL) {
      return '/';
    } else {
      return conf.logoutURL;
    }
  }
}