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
                <div>
                    <h3>💬 Feedback</h3>
                    <p class="feedback-subtitle">Help this agent improve</p>
                </div>
                <button class="feedback-panel-toggle" id="feedback-panel-toggle" title="Collapse panel">
                    ◀
                </button>
            </div>

            <!-- Quick Feedback Widget -->
            <div class="feedback-widget">
                <h4>How was this response?</h4>
                <div class="rating-buttons">
                    <button class="btn-thumb thumbs-up" data-rating="positive">
                        <span class="thumb-icon">👍</span>
                        <span>Helpful</span>
                    </button>
                    <button class="btn-thumb thumbs-down" data-rating="negative">
                        <span class="thumb-icon">👎</span>
                        <span>Not Helpful</span>
                    </button>
                </div>

                <!-- Optional Quick Note -->
                <div class="feedback-note-input">
                    <label for="quick-note-textarea" style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.5rem; display: block;">Optional: Quick note</label>
                    <textarea
                        id="quick-note-textarea"
                        placeholder="Share specific feedback..."
                        rows="3"
                        maxlength="1000"
                    ></textarea>
                    <div class="note-char-count" id="note-char-count">0/1000</div>
                </div>

                <!-- Quick Tags -->
                <div class="quick-tags">
                    <label style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.5rem; display: block;">Quick tags (optional):</label>
                    <div class="tags-grid">
                        <label class="tag-checkbox">
                            <input type="checkbox" value="missed-information" data-category="accuracy">
                            <span>Missed info</span>
                        </label>
                        <label class="tag-checkbox">
                            <input type="checkbox" value="not-what-i-asked" data-category="instruction">
                            <span>Not what I asked</span>
                        </label>
                        <label class="tag-checkbox">
                            <input type="checkbox" value="wrong-format" data-category="format">
                            <span>Wrong format</span>
                        </label>
                        <label class="tag-checkbox">
                            <input type="checkbox" value="repeated-step" data-category="workflow">
                            <span>Repeated steps</span>
                        </label>
                    </div>
                </div>

                <button class="btn-submit-feedback" id="submit-feedback-btn">
                    Submit Feedback
                </button>
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
                width: 100vw;
                max-width: 100vw;
                height: calc(100vh - 4rem);
                gap: 0;
                overflow-x: hidden;
            }

            .chat-panel-wrapper {
                flex: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
                border-right: 1px solid var(--border, #e5e7eb);
                overflow-y: auto;
                overflow-x: hidden;
                transition: all 0.3s ease;
            }

            .feedback-panel.collapsed ~ .chat-panel-wrapper,
            .feedback-layout:has(.feedback-panel.collapsed) .chat-panel-wrapper {
                flex: 1;
                min-width: 0;
            }

            .feedback-panel {
                flex-shrink: 0;
                width: 380px;
                max-width: 380px;
                background: #f9fafb;
                padding: 1.5rem;
                overflow-y: auto;
                overflow-x: hidden;
                display: flex;
                flex-direction: column;
                gap: 1.5rem;
                transition: all 0.3s ease;
            }

            .feedback-panel.collapsed {
                width: 48px;
                max-width: 48px;
                padding: 0.5rem;
                overflow: hidden;
            }

            .feedback-panel.collapsed .feedback-widget,
            .feedback-panel.collapsed .feedback-subtitle {
                display: none;
            }

            /* Feedback Panel Header */
            .feedback-panel-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 1rem;
            }

            .feedback-panel-header h3 {
                margin: 0;
                font-size: 1.125rem;
                color: #111827;
                font-weight: 600;
            }

            .feedback-panel-toggle {
                background: white;
                border: 1px solid #d1d5db;
                border-radius: 0.375rem;
                padding: 0.25rem 0.5rem;
                cursor: pointer;
                font-size: 1rem;
                color: #6b7280;
                transition: all 0.2s ease;
                flex-shrink: 0;
            }

            .feedback-panel-toggle:hover {
                background: #f3f4f6;
                border-color: #9ca3af;
                color: #111827;
            }

            .feedback-panel.collapsed .feedback-panel-toggle {
                transform: rotate(180deg);
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

            /* Feedback Widget */
            .feedback-widget {
                background: white;
                border-radius: 0.75rem;
                padding: 1rem;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            }

            .feedback-widget h4 {
                font-size: 0.875rem;
                color: #111827;
                margin: 0 0 0.75rem 0;
                font-weight: 600;
            }

            /* Quick Tags */
            .quick-tags {
                margin-top: 1rem;
            }

            .tags-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 0.5rem;
            }

            .tag-checkbox {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.5rem;
                border: 1px solid #e5e7eb;
                border-radius: 0.375rem;
                cursor: pointer;
                transition: all 0.2s;
                font-size: 0.8125rem;
                color: #374151;
            }

            .tag-checkbox:hover {
                border-color: #3b82f6;
                background: #eff6ff;
            }

            .tag-checkbox input[type="checkbox"] {
                width: 1rem;
                height: 1rem;
                cursor: pointer;
            }

            .tag-checkbox input[type="checkbox"]:checked + span {
                color: #1f2937;
                font-weight: 500;
            }

            /* Submit Feedback Button */
            .btn-submit-feedback {
                width: 100%;
                padding: 0.75rem;
                background: #10b981;
                color: white;
                border: none;
                border-radius: 0.5rem;
                cursor: pointer;
                font-size: 0.875rem;
                font-weight: 600;
                margin-top: 1rem;
                transition: background 0.2s;
            }

            .btn-submit-feedback:hover:not(:disabled) {
                background: #059669;
            }

            .btn-submit-feedback:disabled {
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

            .btn-thumb.active.thumbs-up {
                border-color: #10b981;
                background: #d1fae5;
                border-width: 2px;
            }

            .btn-thumb.active.thumbs-down {
                border-color: #ef4444;
                background: #fee2e2;
                border-width: 2px;
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
                    width: 100vw;
                    max-width: 100vw;
                }

                .chat-panel-wrapper {
                    flex: 1;
                    min-width: 0;
                    border-right: none;
                    border-bottom: 1px solid var(--border, #e5e7eb);
                }

                .feedback-panel {
                    width: 100%;
                    max-width: 100%;
                    height: 300px;
                }

                .feedback-panel.collapsed {
                    height: 48px;
                    width: 100%;
                }
            }
        `;

        document.head.appendChild(style);
    }

    attachEventListeners() {
        // Feedback panel toggle button
        const toggleBtn = document.getElementById('feedback-panel-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const panel = document.getElementById('feedback-panel');
                if (panel) {
                    panel.classList.toggle('collapsed');
                    // Update tooltip
                    if (panel.classList.contains('collapsed')) {
                        toggleBtn.setAttribute('title', 'Expand panel');
                    } else {
                        toggleBtn.setAttribute('title', 'Collapse panel');
                    }
                }
            });
        }

        // Rating buttons (thumbs up/down)
        const ratingButtons = document.querySelectorAll('.btn-thumb');
        console.log(`🔘 Found ${ratingButtons.length} rating buttons`);

        ratingButtons.forEach((btn, index) => {
            const rating = btn.dataset.rating;
            console.log(`   Button ${index}: rating="${rating}", classes="${btn.className}"`);

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const clickedRating = btn.dataset.rating;
                console.log(`👆 Clicked button with rating: "${clickedRating}"`);

                // Remove active from all buttons
                ratingButtons.forEach(b => b.classList.remove('active'));
                // Add active to clicked button
                btn.classList.add('active');
                // Store selected rating
                this.selectedRating = clickedRating;

                console.log(`✓ Selected rating stored: "${this.selectedRating}"`);
            });
        });

        // Submit feedback button
        const submitBtn = document.getElementById('submit-feedback-btn');
        if (submitBtn) {
            submitBtn.addEventListener('click', () => this.submitFeedback());
        }

        // Character count
        const textarea = document.getElementById('quick-note-textarea');
        if (textarea) {
            textarea.addEventListener('input', (e) => {
                const count = e.target.value.length;
                document.getElementById('note-char-count').textContent = `${count}/1000`;
            });
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

    async submitFeedback() {
        console.log(`📤 submitFeedback() called, selectedRating: "${this.selectedRating}"`);

        // Check if rating is selected
        if (!this.selectedRating) {
            alert('Please select a rating (👍 or 👎) before submitting');
            return;
        }

        const submitBtn = document.getElementById('submit-feedback-btn');
        const textarea = document.getElementById('quick-note-textarea');
        const feedbackText = textarea.value.trim();

        // Get selected quick tags
        const selectedTags = [];
        const checkboxes = document.querySelectorAll('.tag-checkbox input[type="checkbox"]:checked');
        checkboxes.forEach(cb => selectedTags.push(cb.value));

        console.log(`📊 Submitting: rating="${this.selectedRating}", text="${feedbackText}", tags=${JSON.stringify(selectedTags)}`);

        // Disable button
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        try {
            const response = await fetch('/api/feedback', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    conversationId: this.conversationId,
                    messageIndex: this.messageCount,
                    rating: this.selectedRating,
                    feedbackText: feedbackText || undefined,
                    quickTags: selectedTags.length > 0 ? selectedTags : undefined,
                    revisionCount: this.revisionCount,
                    completionTime: Math.floor((Date.now() - this.conversationStartTime) / 1000),
                    messageCount: this.messageCount
                })
            });

            const data = await response.json();

            if (data.success) {
                // Clear form
                textarea.value = '';
                document.getElementById('note-char-count').textContent = '0/1000';
                document.querySelectorAll('.btn-thumb').forEach(b => b.classList.remove('active'));
                checkboxes.forEach(cb => cb.checked = false);
                this.selectedRating = null;

                // Show success message
                submitBtn.textContent = '✓ Feedback submitted!';
                submitBtn.style.background = '#10b981';
                setTimeout(() => {
                    submitBtn.textContent = 'Submit Feedback';
                    submitBtn.style.background = '#10b981';
                    submitBtn.disabled = false;
                }, 3000);

                console.log('✅ Feedback submitted successfully');
            } else {
                alert('Failed to submit feedback: ' + (data.error || 'Unknown error'));
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit Feedback';
            }
        } catch (error) {
            console.error('Error submitting feedback:', error);
            alert('Failed to submit feedback. Please try again.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Feedback';
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

    async rateConversation(rating, messageIndex) {
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
                    messageIndex: messageIndex,
                    rating: rating,
                    revisionCount: this.revisionCount,
                    completionTime: completionTime,
                    messageCount: this.messageCount
                })
            });

            const data = await response.json();

            if (data.success) {
                console.log(`✅ Message ${messageIndex} rated: ${rating} (quality: ${data.feedback.quality_score})`);
                return true;
            } else {
                console.error('Failed to save rating:', data.error);
                return false;
            }
        } catch (error) {
            console.error('Error saving rating:', error);
            alert('Failed to save rating. Please try again.');
            return false;
        }
    }

    // Public methods to track conversation stats
    incrementMessageCount() {
        this.messageCount++;
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
