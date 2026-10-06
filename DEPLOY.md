# Push to GitHub and put it online

## 1. Push the repository

Create an **empty** repository on github.com (no README, no .gitignore, no license), then in this folder:

```bash
git init
git add -A
git commit -m "RollTrack 1.6.3"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/rolltrack.git
git push -u origin main
```

If git asks who you are: `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"` (use the no-reply address GitHub shows in your email settings if you want to keep your email private).

## 2. Put the dashboard demo online

### Option A: GitHub Pages (free)

1. In the repository: **Settings, Pages**.
2. Source: **Deploy from a branch**. Branch: **main**. Folder: **/docs**. Save.
3. Wait a minute or two. The site appears at `https://YOUR-USERNAME.github.io/rolltrack/`.

### Option B: Vercel (free)

1. On vercel.com choose **Add New, Project** and import the GitHub repository.
2. Leave everything as it is: `vercel.json` sets *Framework: Other*, no build command, output directory `docs`.
3. Press **Deploy**. Every push to `main` redeploys.

You can use both at the same time.

## 3. Publish the extension itself

A website cannot run the extension. People use it in one of two ways:

- **Download and load it yourself (no review needed).** Create a release; the workflow in `.github/workflows/release.yml` attaches a zip of `extension/`:
  ```bash
  git tag v1.6.3
  git push origin v1.6.3
  ```
  Users unzip it and use **Load unpacked** in `chrome://extensions`.
- **Chrome Web Store (for the public).** Zip the **contents** of `extension/` (so `manifest.json` is at the top of the zip) and upload it in the Chrome Web Store developer dashboard. This needs a developer account (a small one-time fee) and a review. You will be asked for a privacy statement; the README's Privacy section is a good base.

## 4. After you change something

- Changed `extension/`? Run `node scripts/build-demo.mjs` to refresh `docs/`, then commit and push.
- New version? Update `version` in `extension/manifest.json`, commit, push, and tag it (`git tag vX.Y.Z && git push origin vX.Y.Z`).

## Troubleshooting

| Problem | Fix |
|---|---|
| GitHub Pages shows 404 | Check Settings, Pages points to `main` and `/docs`; wait a few minutes. |
| Vercel shows a blank or 404 page | Project Settings, General: Output Directory must be `docs`, Build Command empty. |
| Demo opens empty | You opened it with `?empty`, or your browser blocks local storage. Open `?reset`. |
| Extension shows nothing on Meet | Reload the extension, then reload the Meet tab; open the People panel; use the widget's magnifier, **Copy report**. |
