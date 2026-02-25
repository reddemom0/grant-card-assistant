# GetGranted Chat Widget

Embeddable chat widget for Granted Consulting's lead generation chatbot.

## Features

- **Two Modes**: Floating chat bubble or inline embedded widget
- **Zero Dependencies**: Pure vanilla JavaScript, no external libraries
- **Shadow DOM**: Isolated styles that won't conflict with your site
- **Responsive**: Works great on mobile, tablet, and desktop
- **SSE Streaming**: Real-time responses streamed from the AI
- **Smart Rate Limiting**: Built-in protection against abuse

## Quick Start

### Floating Widget (Site-Wide)

Add this code before the closing `</body>` tag on your site:

```html
<script src="https://YOUR_RAILWAY_URL/widget/getgranted-widget.js"></script>
<script>
  GetGrantedWidget.init({
    mode: 'floating',
    apiUrl: 'https://YOUR_RAILWAY_URL',
    greeting: true,
    greetingDelay: 3000
  });
</script>
```

### Inline Embed (Specific Page)

Add this code where you want the chat to appear:

```html
<div id="getgranted-chat"></div>
<script src="https://YOUR_RAILWAY_URL/widget/getgranted-widget.js"></script>
<script>
  GetGrantedWidget.init({
    mode: 'inline',
    apiUrl: 'https://YOUR_RAILWAY_URL',
    container: '#getgranted-chat',
    quickActions: [
      "We're a tech company",
      "Construction / trades",
      "Food & beverage",
      "Something else"
    ]
  });
</script>
```

**Important:** Replace `YOUR_RAILWAY_URL` with your actual Railway deployment URL (e.g., `https://your-app.up.railway.app`).

## Configuration Options

### Common Options (Both Modes)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | `'floating'` \| `'inline'` | `'floating'` | Widget display mode |
| `apiUrl` | `string` | **required** | Your Railway API endpoint URL |

### Floating Mode Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `greeting` | `boolean` | `true` | Show greeting tooltip after delay |
| `greetingDelay` | `number` | `3000` | Milliseconds before greeting appears |
| `greetingText` | `string` | See below | Custom greeting message |
| `position` | `'bottom-right'` \| `'bottom-left'` | `'bottom-right'` | Chat bubble position |

**Default greeting text:**
> 👋 Curious what grant funding your company could qualify for? I can help you figure that out in a few minutes.

### Inline Mode Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `container` | `string` \| `HTMLElement` | **required** | CSS selector or DOM element for container |
| `quickActions` | `string[]` | `[]` | Quick action chips displayed below first message |

### Example: Customized Floating Widget

```javascript
GetGrantedWidget.init({
  mode: 'floating',
  apiUrl: 'https://your-app.up.railway.app',
  greeting: true,
  greetingDelay: 5000,
  greetingText: '💡 Need help finding grants for your business? Let\'s chat!',
  position: 'bottom-left'
});
```

### Example: Inline Widget with Custom Quick Actions

```javascript
GetGrantedWidget.init({
  mode: 'inline',
  apiUrl: 'https://your-app.up.railway.app',
  container: '#grant-calculator',
  quickActions: [
    "Tech / Software",
    "Manufacturing",
    "Healthcare / Life sciences",
    "Agriculture / Food & bev",
    "Construction / Trades",
    "Professional services"
  ]
});
```

## WordPress Integration

### Method 1: Using a Plugin (Recommended)

1. Install the **Insert Headers and Footers** plugin
2. Go to **Settings → Insert Headers and Footers**
3. Paste the widget code in the **Footer** section
4. Save changes

### Method 2: Editing Theme Files

1. Go to **Appearance → Theme Editor**
2. Open `footer.php` (or your theme's equivalent)
3. Find the closing `</body>` tag
4. Paste the widget code just before it
5. Update the file

### Inline Widget on Specific Page

1. Edit the page in WordPress (e.g., `/get-started/`)
2. Add a **Custom HTML** block where you want the widget
3. Paste the inline widget code
4. Publish or update the page

### Draft Testing (Important!)

Before going live:

1. Create/edit the page with the widget code
2. **Save as Draft** (don't publish yet)
3. Click **Preview** to see the page with the widget running
4. Test the full conversation flow
5. Only publish when satisfied with the experience

The preview will connect to your production API, so you can test the real experience before making it public.

## Demo Pages

To test the widget locally:

1. Start your development server: `npm run dev`
2. Open in browser:
   - **Floating mode**: `http://localhost:3000/widget/demo-floating.html`
   - **Inline mode**: `http://localhost:3000/widget/demo-inline.html`

Or test on production:
- `https://YOUR_RAILWAY_URL/widget/demo-floating.html`
- `https://YOUR_RAILWAY_URL/widget/demo-inline.html`

## Design Specs

### Brand Colors

The widget uses Granted Consulting's brand colors:

- Primary: `#008abf` (Bright Blue)
- Primary Hover: `#006d99`
- Primary Light: `#e5f4fa`
- Grey: `#6d7881`
- Light Grey: `#dde1e3`
- Dark: `#1a2332`
- Light Background: `#f8fafb`

### Dimensions

**Floating Mode:**
- Chat bubble: 62px diameter circle
- Chat panel: 400px wide × 560px tall
- Mobile: Nearly full-width (calc(100vw - 32px))

**Inline Mode:**
- Maximum width: 720px
- Minimum height: 340px
- Grows with conversation

### Typography

System font stack for lightweight performance:
```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

## API Integration

The widget communicates with your backend via:

**Endpoint:** `POST /api/lead-gen/chat`

**Request:**
```json
{
  "session_id": "uuid-or-null-for-first-message",
  "message": "User's message text"
}
```

**Response:** Server-Sent Events (SSE) stream

The widget handles:
- Automatic session ID generation and persistence (in-memory, no localStorage)
- SSE event parsing for real-time streaming
- Message accumulation and display
- Typing indicators
- Error handling and retry logic

## Features in Detail

### Floating Widget

- **Chat Bubble**: Pulsing animation draws attention
- **Greeting Tooltip**: Appears after delay, auto-dismisses after 10s
- **Smooth Animations**: Scale and translate on open/close
- **Auto-hide Logic**: Hides on `/get-started/` if inline widget is present

### Inline Widget

- **Quick Actions**: Clickable chips for common responses
- **Status Indicator**: Green dot showing "online"
- **Trust Badges**: Displayed below chat area
  - 🔒 No data stored
  - ⚡ Instant estimate
  - 🇨🇦 30+ years grant expertise

### Shared Features

- **Auto-scroll**: Keeps latest message visible
- **Typing Indicator**: Three bouncing dots while waiting for response
- **Input Auto-resize**: Textarea grows as user types (max 120px)
- **Enter to Send**: Press Enter to send, Shift+Enter for newline
- **Disabled State**: Input disabled while waiting for response
- **Message Formatting**: Preserves newlines in messages

## Rate Limits

Built-in protection via backend API:

- **50 new sessions** per IP per hour
- **20 messages** per session
- **500 characters** max per message

Users who hit limits receive friendly error messages with guidance.

## Browser Support

- Chrome/Edge 88+
- Firefox 85+
- Safari 14+
- Mobile Safari (iOS 14+)
- Chrome Mobile (Android)

## Technical Details

### Shadow DOM

The widget uses Shadow DOM to isolate its styles from the host page. This means:
- No CSS conflicts with WordPress theme
- Widget styles won't leak out
- Host page styles won't leak in

### No External Dependencies

The widget is 100% self-contained:
- No React, Vue, or other frameworks
- No jQuery
- No external CSS files
- All styles injected via JavaScript

### Session Management

Sessions are managed entirely in-memory (JavaScript variables):
- **No localStorage** - WordPress compatibility
- **No sessionStorage** - WordPress compatibility
- **No cookies** - Privacy-friendly
- Session persists for page duration only

### Performance

- Widget JS: ~25KB (uncompressed, plain JS)
- Loads async without blocking page render
- Shadow DOM minimizes CSS recalculation
- SSE streaming for instant response feel

## Troubleshooting

### Widget doesn't appear

1. Check browser console for JavaScript errors
2. Verify `apiUrl` is correct and accessible
3. Ensure script URL is correct (`/widget/getgranted-widget.js`)
4. Check if Shadow DOM is supported in browser

### Chat doesn't respond

1. Open browser Network tab
2. Send a message
3. Check for successful POST to `/api/lead-gen/chat`
4. Verify response is SSE stream (content-type: text/event-stream)
5. Check console for parsing errors

### Styling conflicts

The widget uses Shadow DOM to prevent conflicts, but if you see issues:
1. Ensure you're not setting global `!important` styles that pierce Shadow DOM
2. Check z-index of floating widget (999999) isn't being overridden
3. Verify no parent containers have `overflow: hidden` that clips the widget

### CORS errors

If you see CORS errors in console:
1. Verify CORS is enabled in `server.js` (should be `app.use(cors())`)
2. Check Railway environment allows cross-origin requests
3. Ensure `apiUrl` matches the actual domain (no mismatched protocols)

### Session ID not persisting

This is expected behavior! Session IDs are stored in-memory only:
- Session persists for page lifetime
- Refreshing the page starts a new session
- This is by design for WordPress compatibility

## Security

- Session IDs are UUIDs (non-sequential)
- Rate limiting prevents abuse
- No sensitive data stored client-side
- All API calls go through CORS-protected endpoints
- Input validation on both client and server

## Support

For issues or questions:
1. Check this README
2. Test with demo pages (`/widget/demo-*.html`)
3. Review browser console for errors
4. Contact Granted Consulting development team

## Version

Current version: **1.0.0**

## License

Proprietary - Granted Consulting © 2024
