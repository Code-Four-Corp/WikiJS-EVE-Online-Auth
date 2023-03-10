# WikiJS - EVE Online Auth
This is a [custom authentication provider](https://docs.requarks.io/dev/authentication) for WikiJS which allows users to login using [EVE Online's SSO service](https://docs.esi.evetech.net/docs/sso/).

The provider can check if the selected character is a member of a provided list of corporations and assign WikiJS groups based on the character's in-game roles and titles. Groups are synced every time the user logs in.

## Usage
Place `definition.yml` and `authentication.js` in a folder such as `.../modules/authentication/eveonline` within the WikiJS installation. The server will need to be restarted to pick up the new provider.

### Groups
Any WikiJS groups that you make with the same name as an in-game corporation permission or title will be automatically synced to users each time they log in. The names are not case-sensitive but must otherwise match exactly.

The provider does not know all of the permissions and titles in the corp. It therefore will remove groups you manually add to a user which do not correspond to any in-game permission or title. To work around this, add part or all of the name of the group to the keyword blacklist in the authentication provider settings. Any group containing one of those keywords will never be automatically removed from a user.

### Corp Membership
The provider will check if a user is a member of any number of specified corporations when they log in. If they are, it can automatically assign any number of roles to the user. Use a tool such as [EveWho](https://evewho.com) to grab the IDs of corporations. Then specify the full name of any groups you want to automatically assign corp members.

## Updating

### authentication.js
Changes made to `authentication.js` will work after a server restart.

### definition.yml
Changes made to `definition.yml` won't be picked up by WikiJS unless the authentication provider is deleted and re-added. However, that means deleting every user that was attached to that provider.

The better method is to update the `authentication.config` column in the WikiJS database. The column contains a JSON serialization of the form values. Adding, editing, or removing keys from that JSON string will be properly reflected in the WikiJS UI.

## Limitations

### Account vs Character
EVE's ESI API does not operate at the account level. It only operates on individual characters. This means that WikiJS cannot know if two characters actually belong to the same player. It also can't merge all of the in-game permissions that a player has across different characters. Users will need to select the character that has the in-game permissions they wish to use within the wiki. Users can register each of their characters, though it requires logging out and back in to switch permissions.

### Character Caching
EVE's ESI API caches character profile information every hour. This means that there can be a delay of up to one hour before WikiJS can sync added or removed roles and titles from a logged-in character.

This provider has a configurable field for ignorable group keywords to assist with this issue. For instance, you can make a group named "Accountant (manual)", add "(manual)" to the keyword blacklist, and then manually add that group to an out-of-sync user. If they log in while their in-game roles still aren't updated, the provider will ignore the group because it contains the string "(manual)". Then, later, you can remove the manual role and let the system manage the real "Accountant" group as normal.

For players that have left the corp, this can mean they have access to the wiki for up to an hour after removal. In such cases, you may want to deactivate the user's wiki account until the cache has updated and their roles can be properly managed by the system.