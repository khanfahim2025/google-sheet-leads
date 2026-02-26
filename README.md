# Central Lead Script

This repo now contains only a central microsite script:

- `public/lead-bridge.js`

Use it in every microsite:

```html
<script src="https://cdn.yourdomain.com/lead-bridge.js" defer></script>
```

The script captures lead payloads and forwards them directly to your Google Apps Script webhook.

## Configure Once

Edit `public/lead-bridge.js`:

- `CONFIG.webhook`: your Apps Script `/exec` URL
- `CONFIG.projectByHost`: map microsite host to `project_id`
