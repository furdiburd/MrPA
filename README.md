# Annoyed by people privating their contribution history on Reddit?
Don't worry - the solution is here.

**Make Reddit (Profiles) Public Again (MrPa)**

MrPa uses Reddit's own search pages to fetch a user's recent posts and comments and injects them into the profile page so you can view contribution history that may be hidden by the profile UI.

- Uses public Reddit search endpoints to gather posts and comments by author.
- Injects a compact feed into the profile page (posts/comments, scores, timestamps; everything that Reddit shows normally).
- Caches results in sessionStorage for a short time (10 minutes) to reduce requests.
### Please report any issues or suggestions in the GitHub repo issue tracker. 
- A change in Reddit's page structure could break the extension temporaly.

## Installation
- The extension is not yet avabile in the Chrome Web Store or Firefox Add-ons. For now you can install it manually as an unpacked extension.
- Clone or download this repository.
- In Chrome/Edge: Go to `chrome://extensions/`, enable "Developer mode", click "Load unpacked", and select the folder where you downloaded the repo.
- In Firefox: Go to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", and select the manifest.json file in the downloaded repo folder.
- The extension should now be active. Visit a Reddit user profile with private contributions to see it in action.

