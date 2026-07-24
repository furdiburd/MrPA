# Annoyed by people privating their contribution history on Reddit?
Don't worry - the solution is here.

**Make Reddit (Profiles) Public Again (MrPa)**

MrPa uses Reddit's own search pages to fetch a user's recent posts and comments and injects them into the profile page so you can view contribution history that may be hidden by the profile UI.

- Uses Reddit search endpoints (including `/svc/shreddit/search/`) to gather posts and comments by username.
- Filters results to the exact profile username so off-target search hits are excluded, with a byline-text fallback when Reddit omits structured author metadata.
- Injects a compact feed into the profile page (posts/comments, scores, timestamps; everything that Reddit shows normally).
- Caches results in sessionStorage for a short time (10 minutes) to reduce requests.
### Please report any issues or suggestions in the GitHub repo issue tracker. 
- A change in Reddit's page structure could break the extension temporaly.

## Installation
- On chrome just install it from the Chrome Webstore
- https://chromewebstore.google.com/detail/make-reddit-profiles-publ/omeekklkkanmadacloahobkakdclmdip

- On Firefox, install it from the Firefox Add-ons site
- https://addons.mozilla.org/en-US/firefox/addon/make-reddit-profiles-public-ag/
- The extension should now be active. Visit a Reddit user profile with private contributions to see it in action.

