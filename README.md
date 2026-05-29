# Cork Vegans Website

Official website for the Cork Vegans community.

## Overview

This is a lightweight static website built with HTML and Tailwind CSS (via CDN). The site provides information about the Cork Vegans community, upcoming events, and links to social platforms where members can connect.

## Features

- Responsive design
- Tailwind CSS styling
- Smooth scrolling navigation
- Shrinking sticky navigation bar
- Community information section
- Upcoming events section
- Social and community links
- Mobile-friendly layout

## Project Structure

```text
/
├── index.html
├── images/
│   ├── logo.png
│   ├── hero.jpg
│   ├── bio.jpg
│   └── socials/
│       ├── meetup.png
│       ├── facebook.png
│       ├── whatsapp.png
│       ├── insta.png
│       └── foodmap.png
├── favicon/
│   ├── favicon.svg
│   ├── favicon.ico
│   └── favicon-96x96.png
└── site.webmanifest
```

## Development

This website is a static HTML site and does not require a build step.

### Run Locally

Open `index.html` directly in your browser, or start a local web server:

```bash
python -m http.server 8000
```

Then visit:

```text
http://localhost:8000
```

## Updating Content

### Community Links

Update the links in the **Get Connected** section within `index.html`.

### Events

Upcoming events are defined in the **Events** section of `index.html`.

Each event includes:

- Title
- Description
- Date
- Location
- Attendance information
- Link to Meetup

### Images

Replace images in the `images/` directory while keeping the same filenames, or update image paths in `index.html`.

## Social Preview Image

The website supports Open Graph metadata for social sharing previews.

Recommended image size:

```text
1200 × 630 px
```

Suggested location:

```text
images/share-thumbnail.jpg
```

Example Open Graph configuration:

```html
<meta property="og:title" content="Cork Vegans" />
<meta
    property="og:description"
    content="Join Cork's vibrant vegan community for meetups, dining events, potlucks, and plant-based living."
/>
<meta
    property="og:image"
    content="https://your-domain.com/images/share-thumbnail.jpg"
/>
<meta property="og:url" content="https://your-domain.com/" />
<meta property="og:type" content="website" />
```

## Technologies

- HTML5
- Tailwind CSS (CDN)
- Vanilla JavaScript
- Google Fonts (Karla)
- Google Material Symbols

## Accessibility

Current accessibility features include:

- Semantic HTML structure
- Alt text on images
- Keyboard-accessible navigation
- Responsive layouts
- Reduced-motion support

## Deployment

This site can be deployed to any static hosting platform:

- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages
- Traditional web hosting

No build process is required.

## Contributing

Contributions are welcome. Please submit a pull request or contact the Cork Vegans organisers with suggested improvements.

## License

Content and branding are the property of Cork Vegans unless otherwise stated.
