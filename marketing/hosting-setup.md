# Hosting the Privacy Policy & Support Pages (Free)

The HTML files are in `/docs`. Here's how to get them live on a real URL.

## Option A: GitHub Pages (recommended — free, stable, 5 minutes)

1. **Push this project to GitHub** if you haven't:
   ```
   cd ~/nearme
   git init
   git add .
   git commit -m "Initial commit"
   ```
   - Go to github.com → New repository → name it `nearme-support` or `nearme`
   - Copy the commands they give you to push it

2. **Enable GitHub Pages:**
   - In your repo, go to **Settings** → **Pages**
   - **Source:** Deploy from a branch
   - **Branch:** `main`
   - **Folder:** `/docs`
   - Click **Save**

3. **Wait 2-3 minutes**, then your pages are live at:
   - Support: `https://<yourusername>.github.io/<reponame>/`
   - Privacy: `https://<yourusername>.github.io/<reponame>/privacy.html`
   - Terms: `https://<yourusername>.github.io/<reponame>/terms.html`

## Option B: Netlify (drag-and-drop)

1. Go to **https://app.netlify.com/drop**
2. Drag the `/docs` folder onto the page
3. It assigns a URL like `https://sparkly-unicorn-1234.netlify.app`
4. Done

## Option C: Vercel

1. Go to **https://vercel.com/new**
2. Import your GitHub repo → set "Root Directory" to `docs`
3. Deploy

## Update App Store Connect

Once your URLs are live, go to **App Store Connect → Your App → App Information**:
- **Privacy Policy URL:** `https://...privacy.html`
- **Support URL:** `https://.../` (the index)

You can paste these during your first app submission.
