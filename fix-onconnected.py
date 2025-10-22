#!/usr/bin/env python3
import re

files_and_names = [
    ('grant-cards.html', 'grant-cards'),
    ('etg-agent.html', 'etg-writer'),
    ('canexport-claims.html', 'canexport-claims')
]

old_pattern = r'''                chatClient\.onConnected = \(data\) => \{
                    console\.log\('✓ Connected to agent:', data\);
                    // Capture conversationId from backend
                    if \(data\.conversationId && !conversationId\) \{
                        conversationId = data\.conversationId;
                        console\.log\('✓ Captured conversationId from backend:', conversationId\);
                    \}
                \};'''

for file_path, agent_name in files_and_names:
    with open(file_path, 'r') as f:
        content = f.read()

    new_callback = f'''                chatClient.onConnected = (data) => {{
                    console.log('✓ Connected to agent:', data);
                    // Capture conversationId from backend
                    if (data.conversationId && !conversationId) {{
                        conversationId = data.conversationId;
                        localStorage.setItem('{agent_name}-conversation-id', conversationId);
                        console.log('✓ Captured conversationId from backend:', conversationId);

                        // Update URL to include conversationId (for future refreshes)
                        if (isFirstMessage) {{
                            const newUrl = `/{agent_name}/chat/${{conversationId}}`;
                            window.history.pushState({{}}, '', newUrl);
                            console.log('✓ Updated URL to:', newUrl);
                        }}
                    }}
                }};'''

    # Replace all occurrences
    content = re.sub(old_pattern, new_callback, content)

    with open(file_path, 'w') as f:
        f.write(content)

    print(f"✓ Fixed onConnected callbacks in {file_path}")

print("\nAll files updated successfully!")
