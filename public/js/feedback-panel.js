/**
 * Feedback Panel Component
 * Reusable feedback system for all agent pages
 */

class FeedbackPanel {
    constructor(conversationId) {
        this.conversationId = conversationId;
        this.notes = [];
        this.revisionCount = 0;
        this.messageCount = 0;
        this.conversationStartTime = Date.now();
        this.hasRated = false;

        this.init();
    }

    init() {
        this.injectHTML();
        this.attachEventListeners();
        this.loadExistingNotes();
    }

    injectHTML() {
        // Find the container and modify it for split layout
        const container = document.querySelector('.container');
        if (!container) {
            console.error('Container not found');
            return;
        }

        // Create wrapper divs WITHOUT destroying existing DOM
        const feedbackLayout = document.createElement('div');
        feedbackLayout.className = 'feedback-layout';

        const chatPanelWrapper = document.createElement('div');
        chatPanelWrapper.className = 'chat-panel-wrapper';

        const feedbackPanel = document.createElement('div');
        feedbackPanel.className = 'feedback-panel';
        feedbackPanel.id = 'feedback-panel';
        feedbackPanel.innerHTML = this.getFeedbackPanelHTML();

        // Move existing content into wrapper (preserves DOM elements and references)
        while (container.firstChild) {
            chatPanelWrapper.appendChild(container.firstChild);
        }

        // Build new structure
        feedbackLayout.appendChild(chatPanelWrapper);
        feedbackLayout.appendChild(feedbackPanel);
        container.appendChild(feedbackLayout);

        this.injectStyles();
    }

    getFeedbackPanelHTML() {
        return `
            <div class="feedback-panel-header">
                <h3>💬 Feedback</h3>
                <p class="feedback-subtitle">Help this agent improve</p>
            </div>

            <!-- Quick Note Entry -->
            <div class="feedback-note-input">
                <textarea
                    id="quick-note-textarea"
                    placeholder="Share your thoughts as we go..."
                    rows="3"
                    maxlength="1000"
                ></textarea>
                <div class="note-char-count" id="note-char-count">0/1000</div>
                <button class="btn-save-note" id="save-note-btn">
                    Save Note
                </button>
            </div>

            <!-- Previous Notes -->
            <div class="feedback-notes-list">
                <h4>Your Notes</h4>
                <div id="notes-container" class="notes-container">
                    <p class="no-notes" id="no-notes-message">No notes yet. Add your first note above!</p>
                </div>
            </div>

            <!-- Separator -->
            <hr class="feedback-divider">

            <!-- Overall Rating (appears after 3+ messages) -->
            <div id="overall-rating" class="overall-rating hidden">
                <h4>How's this conversation?</h4>
                <div class="rating-buttons">
                    <button class="btn-thumb thumbs-up" id="thumbs-up-btn">
                        <span class="thumb-icon">👍</span>
                        <span>Helpful</span>
                    </button>
                    <button class="btn-thumb thumbs-down" id="thumbs-down-btn">
                        <span class="thumb-icon">👎</span>
                        <span>Not Helpful</span>
                    </button>
                </div>
            </div>

            <!-- Thank you message -->
            <div id="rating-thanks" class="rating-thanks hidden">
                <p>✓ Thanks for your feedback!</p>
                <p class="rating-thanks-detail">Your input helps improve this agent.</p>
            </div>
        `;
    }

    injectStyles() {
        if (document.getElementById('feedback-panel-styles')) {
            return; // Already injected
        }

        const style = document.createElement('style');
        style.id = 'feedback-panel-styles';
        style.textContent = `
            /* Feedback Layout */
            .feedback-layout {
                display: flex;
                height: calc(100vh - 4rem);
                gap: 0;
            }

            .chat-panel-wrapper {
                flex: 0 0 70%;
                display: flex;
                flex-direction: column;
                border-right: 1px solid var(--border, #e5e7eb);
                overflow-y: auto;
            }

            .feedback-panel {
                flex: 0 0 30%;
                background: #f9fafb;
                padding: 1.5rem;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 1.5rem;
            }

            /* Feedback Panel Header */
            .feedback-panel-header h3 {
                margin: 0;
                font-size: 1.125rem;
                color: #111827;
                font-weight: 600;
            }

            .feedback-subtitle {
                font-size: 0.875rem;
                color: #6b7280;
                margin: 0.25rem 0 0 0;
            }

            /* Note Input */
            .feedback-note-input {
                position: relative;
            }

            .feedback-note-input textarea {
                width: 100%;
                padding: 0.75rem;
                border: 1px solid #d1d5db;
                border-radius: 0.5rem;
                font-size: 0.875rem;
                font-family: inherit;
                resize: vertical;
                transition: border-color 0.2s;
            }

            .feedback-note-input textarea:focus {
                outline: none;
                border-color: #3b82f6;
                box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
            }

            .note-char-count {
                font-size: 0.75rem;
                color: #9ca3af;
                margin-top: 0.25rem;
                text-align: right;
            }

            .btn-save-note {
                width: 100%;
                padding: 0.625rem;
                background: #3b82f6;
                color: white;
                border: none;
                border-radius: 0.5rem;
                cursor: pointer;
                font-size: 0.875rem;
                font-weight: 500;
                margin-top: 0.5rem;
                transition: background 0.2s;
            }

            .btn-save-note:hover:not(:disabled) {
                background: #2563eb;
            }

            .btn-save-note:disabled {
                background: #9ca3af;
                cursor: not-allowed;
            }

            /* Notes List */
            .feedback-notes-list h4 {
                font-size: 0.875rem;
                color: #6b7280;
                margin: 0 0 0.75rem 0;
                font-weight: 600;
            }

            .notes-container {
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
            }

            .no-notes {
                font-size: 0.875rem;
                color: #9ca3af;
                font-style: italic;
                margin: 0;
            }

            .note-item {
                background: white;
                padding: 0.75rem;
                border-radius: 0.5rem;
                border-left: 3px solid #3b82f6;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
            }

            .note-item.positive {
                border-left-color: #10b981;
            }

            .note-item.negative {
                border-left-color: #ef4444;
            }

            .note-item.mixed {
                border-left-color: #f59e0b;
            }

            .note-text {
                font-size: 0.875rem;
                color: #111827;
                margin-bottom: 0.5rem;
                line-height: 1.5;
            }

            .note-meta {
                font-size: 0.75rem;
                color: #6b7280;
                display: flex;
                align-items: center;
                gap: 0.5rem;
            }

            .note-sentiment {
                padding: 0.125rem 0.375rem;
                background: #f3f4f6;
                border-radius: 0.25rem;
                font-weight: 500;
            }

            /* Divider */
            .feedback-divider {
                border: none;
                border-top: 1px solid #e5e7eb;
                margin: 0;
            }

            /* Overall Rating */
            .overall-rating h4 {
                font-size: 0.875rem;
                color: #111827;
                margin: 0 0 0.75rem 0;
                font-weight: 600;
            }

            .rating-buttons {
                display: flex;
                gap: 0.5rem;
            }

            .btn-thumb {
                flex: 1;
                padding: 0.75rem;
                border: 2px solid #d1d5db;
                background: white;
                border-radius: 0.5rem;
                cursor: pointer;
                font-size: 0.875rem;
                font-weight: 500;
                transition: all 0.2s;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 0.25rem;
            }

            .btn-thumb:hover {
                border-color: #3b82f6;
                background: #eff6ff;
            }

            .btn-thumb.thumbs-up:hover {
                border-color: #10b981;
                background: #ecfdf5;
            }

            .btn-thumb.thumbs-down:hover {
                border-color: #ef4444;
                background: #fef2f2;
            }

            .thumb-icon {
                font-size: 1.5rem;
            }

            /* Thank You Message */
            .rating-thanks {
                background: #ecfdf5;
                border: 1px solid #a7f3d0;
                border-radius: 0.5rem;
                padding: 1rem;
                text-align: center;
            }

            .rating-thanks p {
                margin: 0;
                color: #065f46;
                font-weight: 500;
            }

            .rating-thanks-detail {
                font-size: 0.75rem;
                color: #047857;
                font-weight: 400;
                margin-top: 0.25rem !important;
            }

            /* Hidden class */
            .hidden {
                display: none !important;
            }

            /* Responsive */
            @media (max-width: 1024px) {
                .feedback-layout {
                    flex-direction: column;
                }

                .chat-panel-wrapper {
                    flex: 1;
                    border-right: none;
                    border-bottom: 1px solid var(--border, #e5e7eb);
                }

                .feedback-panel {
                    flex: 0 0 300px;
                }
            }
        `;

        document.head.appendChild(style);
    }

    attachEventListeners() {
        // Save note button
        const saveNoteBtn = document.getElementById('save-note-btn');
        if (saveNoteBtn) {
            saveNoteBtn.addEventListener('click', () => this.saveNote());
        }

        // Character count
        const textarea = document.getElementById('quick-note-textarea');
        if (textarea) {
            textarea.addEventListener('input', (e) => {
                const count = e.target.value.length;
                document.getElementById('note-char-count').textContent = `${count}/1000`;
            });

            // Enter to save (with Shift+Enter for new line)
            textarea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.saveNote();
                }
            });
        }

        // Thumbs up/down
        const thumbsUpBtn = document.getElementById('thumbs-up-btn');
        const thumbsDownBtn = document.getElementById('thumbs-down-btn');

        if (thumbsUpBtn) {
            thumbsUpBtn.addEventListener('click', () => this.rateConversation('positive'));
        }

        if (thumbsDownBtn) {
            thumbsDownBtn.addEventListener('click', () => this.rateConversation('negative'));
        }
    }

    async loadExistingNotes() {
        try {
            const response = await fetch(`/api/feedback-note?conversationId=${this.conversationId}`, {
                credentials: 'include'
            });
            const data = await response.json();

            if (data.success && data.notes.length > 0) {
                this.notes = data.notes;
                this.renderNotes();
            }
        } catch (error) {
            console.error('Error loading notes:', error);
        }
    }

    async saveNote() {
        const textarea = document.getElementById('quick-note-textarea');
        const noteText = textarea.value.trim();

        if (!noteText) {
            return;
        }

        try {
            const response = await fetch('/api/feedback-note', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    conversationId: this.conversationId,
                    noteText: noteText,
                    messageIndex: this.messageCount
                })
            });

            const data = await response.json();

            if (data.success) {
                // Add to notes list
                this.notes.unshift(data.note);
                this.renderNotes();

                // Clear textarea
                textarea.value = '';
                document.getElementById('note-char-count').textContent = '0/1000';

                console.log('✅ Note saved');
            } else {
                alert('Failed to save note: ' + (data.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error saving note:', error);
            alert('Failed to save note. Please try again.');
        }
    }

    renderNotes() {
        const container = document.getElementById('notes-container');
        const noNotesMsg = document.getElementById('no-notes-message');

        if (this.notes.length === 0) {
            if (noNotesMsg) {
                noNotesMsg.classList.remove('hidden');
            }
            return;
        }

        if (noNotesMsg) {
            noNotesMsg.classList.add('hidden');
        }

        container.innerHTML = this.notes.map(note => `
            <div class="note-item ${note.sentiment || 'neutral'}">
                <div class="note-text">${this.escapeHtml(note.note_text)}</div>
                <div class="note-meta">
                    <span>${this.formatTime(note.created_at)}</span>
                    ${note.sentiment ? `<span class="note-sentiment">${note.sentiment}</span>` : ''}
                </div>
            </div>
        `).join('');
    }

    async rateConversation(rating) {
        if (this.hasRated) {
            return;
        }

        try {
            const completionTime = Math.floor((Date.now() - this.conversationStartTime) / 1000);

            const response = await fetch('/api/feedback', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    conversationId: this.conversationId,
                    rating: rating,
                    revisionCount: this.revisionCount,
                    completionTime: completionTime,
                    messageCount: this.messageCount
                })
            });

            const data = await response.json();

            if (data.success) {
                this.hasRated = true;

                // Hide rating buttons
                document.getElementById('overall-rating').classList.add('hidden');

                // Show thank you
                document.getElementById('rating-thanks').classList.remove('hidden');

                console.log(`✅ Conversation rated: ${rating} (quality: ${data.feedback.quality_score})`);
            } else {
                alert('Failed to save rating: ' + (data.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error saving rating:', error);
            alert('Failed to save rating. Please try again.');
        }
    }

    // Public methods to track conversation stats
    incrementMessageCount() {
        this.messageCount++;

        // Show rating after 3+ messages
        if (this.messageCount >= 3 && !this.hasRated) {
            document.getElementById('overall-rating').classList.remove('hidden');
        }
    }

    incrementRevisionCount() {
        this.revisionCount++;
    }

    // Utility methods
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) {
            return 'Just now';
        } else if (diffMins < 60) {
            return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
        } else if (diffMins < 1440) {
            const diffHours = Math.floor(diffMins / 60);
            return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        } else {
            return date.toLocaleDateString();
        }
    }
}

// Export for use in agent pages
window.FeedbackPanel = FeedbackPanel;
