# Danksagung

A small static thank-you site for a dissertation. Visitors enter a personal code (or scan a personal QR code) and see a message written just for them.

Live site: <https://meltem2116.github.io/danksagung_dissertation/>

## How it works

- Every person gets a random 10-character code such as `K4W7R-9XQ2M` (about 50 bits of randomness).
- In the browser, the code is stretched with PBKDF2-SHA256 (600,000 iterations, a public salt from `docs/data/params.json`). HKDF then turns the result into two values: a file id and an AES-256-GCM key.
- The page loads `docs/data/<id>.bin` and decrypts it. Each file holds everything for that person: greeting, text, photo and signature. Files are padded to fixed sizes, so their size doesn't reveal anything.
- A wrong code, a missing file and a failed decryption all show the same "nothing found" message.
- The repository is public, but it contains no names, messages or codes. The private source data (`people.json`, `content/`, `private/`) is listed in `.gitignore`. On every build, the tool checks that none of those names or codes appear in any file git would publish.
- Plain HTML, CSS and JavaScript with self-hosted fonts. No dependencies and no build step for the site itself.

## Folder layout

```
docs/                 the website (GitHub Pages serves only this folder)
  index.html
  assets/             styles, scripts, fonts, favicon
    text.js           ← landing page text (German + English)
    crypto.js         shared by the browser and the Node tools
  data/               params.json (salt) + encrypted <id>.bin files
tools/                build, test and QR scripts (Node, no npm packages)
people.example.json   two placeholder people (used by the tests)
examples/             files used by the placeholder people
qr/dissertation.svg   QR code for the printed dissertation
people.json           PRIVATE: real people and messages (git-ignored)
content/              PRIVATE: optional message files and photos (git-ignored)
private/              PRIVATE: generated codes.csv and personal QR codes (git-ignored)
```

## Requirements

- Node.js 20 or newer (only for building and testing)
- Python 3 (only for the local preview server)
- On macOS, photos are resized automatically with the built-in `sips`. On other systems, resize photos to about 1600 px yourself before adding them.

## Adding or editing people

1. If `people.json` doesn't exist yet, copy `people.example.json` to `people.json`.
2. Add one entry per person:

   ```json
   {
     "signature": "Meltem",
     "signatureImage": null,
     "people": [
       {
         "name": "Anna Beispiel",
         "lang": "de",
         "greeting": "Liebe Anna,",
         "messageFile": "content/anna.md",
         "photo": "content/anna.jpg",
         "photoAlt": "Wir beide beim Wandern"
       }
     ]
   }
   ```

   | Field | |
   |---|---|
   | `name` | Required. Only used locally (codes list, QR file names). Never published. |
   | `code` | Leave it out. The build generates one and writes it back into `people.json`. **Never change a code after you've given it to someone.** |
   | `greeting` | Heading of the message, e.g. "Liebe Anna,". |
   | `message` / `messageFile` | The text as Markdown, written directly in the JSON or in a file. Supported: paragraphs, line breaks, `**bold**`, `*italic*`, `- lists`, `> quotes`, `[links](https://…)`. |
   | `html` / `htmlFile` | Use instead of Markdown if you want full control. |
   | `photo`, `photoAlt` | Optional photo (jpg, png, webp, svg) and a short description for screen readers. |
   | `lang` | `de` or `en`: the language of this message. |
   | `signature`, `signatureImage` | Set once at the top level; individual people can override them. `signatureImage` can be a scanned signature (transparent PNG or SVG, dark ink). Without it, the signature is set in a handwriting font. |

   Long messages and photos are best kept in `content/`, which git ignores.

3. Remove the demo entry before you hand out real codes.

## Build, test, preview

```sh
npm run build     # encrypts every person into docs/data, prints the codes
npm test          # encrypts the examples and decrypts them with the browser code
npm run serve     # preview at http://localhost:8000
npm run qr        # QR codes (see below)
```

(`npm run …` only runs the scripts; nothing gets installed. `node tools/build.mjs` works just as well.)

The build also writes `private/codes.csv` with each person's name, code and personal link.

To test locally, open `http://localhost:8000/#<CODE>` with a code from `private/codes.csv`, or type the code into the form.

## QR codes

`npm run qr` downloads the `qrcode` npm package on first use (via npx; this is the only external tool) and writes:

- `qr/dissertation.svg`, the general link for the printed dissertation (error correction level H, the highest).
- `private/qr/<name>.svg`, one per person, with the code in the link. Scanning it opens the message directly. The code sits in the `#` part of the URL, which browsers never send to the server, and the page removes it from the address bar right after loading.

Check the dissertation QR code on a printed proof with a couple of phones before the final print.

## Publishing

```sh
npm run build && npm test
git status          # people.json, content/ and private/ must NOT appear
git add docs qr
git commit -m "Update messages"
git push
```

Enable GitHub Pages once: repository **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/docs` → Save**. After a minute or two, the site is live at the address above.

## Things to keep in mind

- **Back up `people.json` and `content/`** somewhere private (not in this repo). They're the only copy of the plain-text messages. The site keeps working without them, but you couldn't edit it anymore.
- **Never rename the GitHub account or the repository.** The printed URL depends on both.
- Rebuilding is always safe. Codes stay the same, and only the encrypted files change. If `docs/data/params.json` is deleted, a new salt is generated and all files are re-encrypted. Existing codes keep working.
- The landing page text is in `docs/assets/text.js`. Colours and fonts are in `docs/assets/style.css`.
- Fonts: Fraunces and Caveat, both under the SIL Open Font License (see `docs/assets/fonts/`).
