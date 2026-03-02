/**
 * Inline Feedback System
 * Lightweight feedback UI that appears below each assistant message
 * Replaces the sidebar approach with inline expansion
 */

class InlineFeedback {
    constructor(conversationId) {
        this.conversationId = conversationId;
        this.messageCount = 0;
        this.conversationStartTime = Date.now();
        this.injectStyles();
    }

    injectStyles() {
        if (document.getElementById('inline-feedback-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'inline-feedback-styles';
        style.textContent = `
            /* Inline Feedback Buttons */
            .message-feedback-inline {
                display: flex;
                gap: 0.5rem;
                margin-top: 0.75rem;
                padding-top: 0.75rem;
                border-top: 1px solid var(--border, #e5e7eb);
                opacity: 0;
                animation: fadeIn 0.3s ease 0.5s forwards;
            }

            @keyframes fadeIn {
                to { opacity: 1; }
            }

            .message.assistant .message-feedback-inline.visible {
                opacity: 1;
            }

            .feedback-btn-inline {
                display: inline-flex;
                align-items: center;
                gap: 0.375rem;
                padding: 0.5rem 0.75rem;
                border: 1.5px solid var(--border, #d1d5db);
                border-radius: 6px;
                background: white;
                color: var(--text-secondary, #6b7280);
                font-size: 0.875rem;
                cursor: pointer;
                transition: all 0.2s ease;
                font-weight: 500;
            }

            .feedback-btn-inline:hover:not(:disabled) {
                border-color: var(--primary, #3b82f6);
                background: var(--primary-light, #eff6ff);
                color: var(--primary, #3b82f6);
            }

            .feedback-btn-inline:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .feedback-btn-inline.selected-positive {
                border-color: #10b981;
                background: #ecfdf5;
                color: #059669;
            }

            .feedback-btn-inline.selected-negative {
                border-color: #ef4444;
                background: #fef2f2;
                color: #dc2626;
            }

            /* Inline Feedback Form (expands on thumbs down) */
            .feedback-form-inline {
                margin-top: 0.75rem;
                padding: 1rem;
                background: #f9fafb;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                display: none;
                animation: slideDown 0.3s ease;
            }

            .feedback-form-inline.visible {
                display: block;
            }

            @keyframes slideDown {
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            .feedback-form-inline textarea {
                width: 100%;
                padding: 0.75rem;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                font-size: 0.875rem;
                font-family: inherit;
                resize: vertical;
                min-height: 80px;
                margin-bottom: 0.75rem;
            }

            .feedback-form-inline textarea:focus {
                outline: none;
                border-color: #3b82f6;
                box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
            }

            .feedback-quick-tags {
                display: flex;
                flex-wrap: wrap;
                gap: 0.5rem;
                margin-bottom: 0.75rem;
            }

            .feedback-tag-option {
                display: inline-flex;
                align-items: center;
                gap: 0.375rem;
                padding: 0.375rem 0.625rem;
                border: 1px solid #d1d5db;
                border-radius: 4px;
                font-size: 0.8125rem;
                cursor: pointer;
                transition: all 0.2s;
                background: white;
                user-select: none;
            }

            .feedback-tag-option:hover {
                border-color: #3b82f6;
                background: #eff6ff;
            }

            .feedback-tag-option input[type="checkbox"] {
                width: 14px;
                height: 14px;
                cursor: pointer;
                margin: 0;
            }

            .feedback-tag-option input:checked + span {
                font-weight: 600;
                color: #1f2937;
            }

            .feedback-form-actions {
                display: flex;
                gap: 0.5rem;
            }

            .feedback-submit-btn {
                flex: 1;
                padding: 0.625rem;
                background: #3b82f6;
                color: white;
                border: none;
                border-radius: 6px;
                font-size: 0.875rem;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.2s;
            }

            .feedback-submit-btn:hover:not(:disabled) {
                background: #2563eb;
            }

            .feedback-submit-btn:disabled {
                background: #9ca3af;
                cursor: not-allowed;
            }

            .feedback-cancel-btn {
                padding: 0.625rem 1rem;
                background: white;
                color: #6b7280;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                font-size: 0.875rem;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
            }

            .feedback-cancel-btn:hover {
                background: #f3f4f6;
                border-color: #9ca3af;
            }

            .feedback-thank-you {
                margin-top: 0.5rem;
                padding: 0.75rem;
                background: #ecfdf5;
                border: 1px solid #a7f3d0;
                border-radius: 6px;
                color: #065f46;
                font-size: 0.875rem;
                font-weight: 500;
                text-align: center;
                display: none;
            }

            .feedback-thank-you.visible {
                display: block;
                animation: slideDown 0.3s ease;
            }
        `;

        document.head.appendChild(style);
    }

    /**
     * Add inline feedback buttons to a message div
     */
    addFeedbackButtons(messageDiv, messageIndex) {
        const feedbackContainer = document.createElement('div');
        feedbackContainer.className = 'message-feedback-inline';
        feedbackContainer.innerHTML = `
            <button class="feedback-btn-inline feedback-btn-up" data-rating="positive">
                👍 Helpful
            </button>
            <button class="feedback-btn-inline feedback-btn-down" data-rating="negative">
                👎 Not helpful
            </button>
        `;

        const feedbackForm = document.createElement('div');
        feedbackForm.className = 'feedback-form-inline';
        feedbackForm.innerHTML = `
            <textarea
                placeholder="What went wrong? (Optional: helps us improve)"
                maxlength="1000"
            ></textarea>
            <div class="feedback-quick-tags">
                <label class="feedback-tag-option">
                    <input type="checkbox" value="missed-information">
                    <span>Missed info</span>
                </label>
                <label class="feedback-tag-option">
                    <input type="checkbox" value="not-what-i-asked">
                    <span>Not what I asked</span>
                </label>
                <label class="feedback-tag-option">
                    <input type="checkbox" value="wrong-format">
                    <span>Wrong format</span>
                </label>
                <label class="feedback-tag-option">
                    <input type="checkbox" value="factual-error">
                    <span>Factual error</span>
                </label>
            </div>
            <div class="feedback-form-actions">
                <button class="feedback-submit-btn">Submit Feedback</button>
                <button class="feedback-cancel-btn">Cancel</button>
            </div>
        `;

        const thankYouMessage = document.createElement('div');
        thankYouMessage.className = 'feedback-thank-you';
        thankYouMessage.textContent = '✓ Thanks for your feedback!';

        // Append all elements
        messageDiv.appendChild(feedbackContainer);
        messageDiv.appendChild(feedbackForm);
        messageDiv.appendChild(thankYouMessage);

        // Show buttons after a brief delay (smoother UX)
        setTimeout(() => feedbackContainer.classList.add('visible'), 500);

        // Event listeners
        const upBtn = feedbackContainer.querySelector('.feedback-btn-up');
        const downBtn = feedbackContainer.querySelector('.feedback-btn-down');
        const textarea = feedbackForm.querySelector('textarea');
        const submitBtn = feedbackForm.querySelector('.feedback-submit-btn');
        const cancelBtn = feedbackForm.querySelector('.feedback-cancel-btn');

        upBtn.addEventListener('click', () => this.handlePositiveFeedback(messageDiv, messageIndex, upBtn, downBtn, feedbackForm, thankYouMessage));
        downBtn.addEventListener('click', () => this.handleNegativeFeedback(messageDiv, messageIndex, upBtn, downBtn, feedbackForm));
        submitBtn.addEventListener('click', () => this.submitNegativeFeedback(messageDiv, messageIndex, feedbackForm, thankYouMessage, textarea));
        cancelBtn.addEventListener('click', () => feedbackForm.classList.remove('visible'));
    }

    /**
     * Handle positive feedback (thumbs up)
     */
    async handlePositiveFeedback(messageDiv, messageIndex, upBtn, downBtn, feedbackForm, thankYouMessage) {
        if (messageDiv.hasAttribute('data-rated')) return;

        upBtn.disabled = true;
        downBtn.disabled = true;

        const success = await this.submitFeedback({
            rating: 'positive',
            messageIndex
        });

        if (success) {
            messageDiv.setAttribute('data-rated', 'true');
            upBtn.classList.add('selected-positive');
            feedbackForm.classList.remove('visible');
            thankYouMessage.classList.add('visible');
            setTimeout(() => thankYouMessage.classList.remove('visible'), 3000);
        } else {
            upBtn.disabled = false;
            downBtn.disabled = false;
        }
    }

    /**
     * Handle negative feedback (thumbs down) - show form
     */
    handleNegativeFeedback(messageDiv, messageIndex, upBtn, downBtn, feedbackForm) {
        if (messageDiv.hasAttribute('data-rated')) return;

        downBtn.classList.add('selected-negative');
        upBtn.disabled = true;
        feedbackForm.classList.add('visible');
        feedbackForm.querySelector('textarea').focus();
    }

    /**
     * Submit negative feedback with text and tags
     */
    async submitNegativeFeedback(messageDiv, messageIndex, feedbackForm, thankYouMessage, textarea) {
        if (messageDiv.hasAttribute('data-rated')) return;

        const submitBtn = feedbackForm.querySelector('.feedback-submit-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        const feedbackText = textarea.value.trim();
        const selectedTags = Array.from(feedbackForm.querySelectorAll('input[type="checkbox"]:checked'))
            .map(cb => cb.value);

        const success = await this.submitFeedback({
            rating: 'negative',
            messageIndex,
            feedbackText: feedbackText || undefined,
            quickTags: selectedTags.length > 0 ? selectedTags : undefined
        });

        if (success) {
            messageDiv.setAttribute('data-rated', 'true');
            feedbackForm.classList.remove('visible');
            thankYouMessage.classList.add('visible');
            setTimeout(() => thankYouMessage.classList.remove('visible'), 3000);
        } else {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Feedback';
        }
    }

    /**
     * Submit feedback to API
     */
    async submitFeedback({ rating, messageIndex, feedbackText, quickTags }) {
        try {
            const response = await fetch('/api/feedback', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversationId: this.conversationId,
                    messageIndex,
                    rating,
                    feedbackText,
                    quickTags,
                    messageCount: this.messageCount,
                    completionTime: Math.floor((Date.now() - this.conversationStartTime) / 1000)
                })
            });

            const data = await response.json();
            if (data.success) {
                console.log(`✅ Feedback submitted: ${rating} for message ${messageIndex}`);
                return true;
            } else {
                console.error('Feedback submission failed:', data.error);
                alert('Failed to submit feedback. Please try again.');
                return false;
            }
        } catch (error) {
            console.error('Error submitting feedback:', error);
            alert('Network error. Please try again.');
            return false;
        }
    }

    /**
     * Increment message count (call when assistant message is added)
     */
    incrementMessageCount() {
        this.messageCount++;
    }
}

// Export for use in agent pages
window.InlineFeedback = InlineFeedback;
