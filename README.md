# Central Lead Script

This repo now contains only a central microsite script:

- `public/lead-bridge.js`

Use it in every microsite (same URL for all future updates):

```html
<script
  src="https://cdn.jsdelivr.net/gh/khanfahim2025/google-sheet-leads@main/public/lead-bridge.js"
  data-leadhub-project-id="5790"
  data-leadhub-site-domain="www.mahalaxmi-bellevue.com"
  data-leadhub-site-name="Mahalaxmi Bellevue"
  defer
></script>
```

The script captures lead payloads and forwards them directly to your Google Apps Script webhook.

## Configure Once

Edit `public/lead-bridge.js`:

- `CONFIG.webhook`: your Apps Script `/exec` URL
- `CONFIG.projectByHost`: map microsite host to `project_id`

## Deploy Flow (No URL Change Needed)

1. Push script changes to `main`.
2. Purge jsDelivr cache for fast rollout:
   - `https://purge.jsdelivr.net/gh/khanfahim2025/google-sheet-leads@main/public/lead-bridge.js`
