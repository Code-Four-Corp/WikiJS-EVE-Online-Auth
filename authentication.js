const _ = require('lodash')
/* global WIKI */

// ------------------------------------
// EveOnline Account
// ------------------------------------

const OAuth2Strategy = require('passport-oauth2').Strategy
var jwt = require('jsonwebtoken');

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
    roles = roles.map(f => f.toLowerCase().trim().replace(/_/g, " "));
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
    data = data.map(f => f.name.toLowerCase().trim().replace(/_/g, " "));
  }

  return data || [];
}

const getProfile = async ({ profile }) => {
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

          const corpIds = conf.corpIds;

          if (corpIds?.length > 0) {
            // Get the character profile.
            const profileData = await getProfile({ profile });

            const corpIdsArray = corpIds.split(",").map(f => f.trim());
            const keywordBlacklist = conf.keywordBlacklist?.split(",")?.map(f => f.toLowerCase().trim()) || [];
            const memberGroupNames = conf.corpMemberGroupNames?.split(",")?.map(f => f.toLowerCase().trim()) || [];

            const isMember = corpIdsArray.includes(`${profileData?.corporation_id}`);
            WIKI.logger.info(isMember ? 'Is corp member' : `Is not corp member (${profileData?.corporation_id})`);

            if (isMember) {
              // Get the characters's corp roles and titles.
              const [roles, titles, currentGroupsRaw] = await Promise.all([
                getRoles({ profile, accessToken }),
                getTitles({ profile, accessToken }),
                user.$relatedQuery('groups').select('groups.id'),
              ]);

              const rolesAndTitles = [
                ...roles,
                ...titles,
              ];

              WIKI.logger.info(`Roles and titles: ${JSON.stringify(rolesAndTitles)}`);

              const allGroups = Object.values(WIKI.auth.groups);
              const memberGroups = allGroups.filter(f => memberGroupNames.includes(f.name.trim().toLowerCase()));

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
              const groupsToRemove = _.difference(currentGroups, expectedGroups);

              await Promise.all([
                ...groupsToAdd.map(f => addGroup({ user, allGroups, groupId: f })),
                ...groupsToRemove.map(f => removeGroup({ user, allGroups, groupId: f, keywordBlacklist })),
              ]);
            }
          }

          cb(null, user);
        } catch (err) {
          cb(err, null);
        }
      });

    OAuth2Strategy.prototype.userProfile = function (accessToken, done) {
      try {
        const payload = jwt.decode(accessToken);
        const sub = payload.sub;
        const chardetail = sub.split(":");
        const charid = chardetail[2];

        WIKI.logger.info(`Authenticating '${payload.name}' (${charid})`);

        done(null, {
          id: charid,
          displayName: payload.name,
          email: charid + '@auth.eveonline.com',
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