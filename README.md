# WikiJS - EVE Online Auth
EVE Online SSO authentication provider for WikiJS

## Usage
Place `definition.yml` and `authentication.js` in a folder such as `.../modules/authentication/eveonline` within the WikiJS installation. The server will need to be restarted to pick up the new provider.

## Updating

### authentication.js
Changes made to `authentication.js` will work after a server restart.

### definition.yml
Changes made to `definition.yml` won't be picked up by WikiJS unless the authentication provider is deleted and re-added. However, that means deleting every user that was attached to that provider.

The better method is to update the `authentication.config` column in the WikiJS database. The column contains a JSON serialization of the form values. Adding, editing, or removing keys from that JSON string will be properly reflected in the WikiJS UI.