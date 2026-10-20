function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function showModalNotifyAT(messages, title) {
    return new Promise((resolve) => {
        const existingOverlay = document.getElementById('custom-modal-overlay');
        if (existingOverlay) existingOverlay.remove();

        const overlay = document.createElement('div');
        overlay.id = 'custom-modal-overlay';

        const modal = document.createElement('div');
        modal.id = 'custom-modal';

        modal.innerHTML = `
            <h2>${escapeHTML(title)}</h2>
            <div class="modal-content">
                ${messages.map(msg => `<p>${escapeHTML(msg)}</p>`).join('')}
            </div>
            <button id="modal-close-btn">Хорошо. Я прочитал(а).</button>
        `;

        modal.querySelector('#modal-close-btn').addEventListener('click', () => {
            overlay.remove();
            document.body.style.overflow = '';
            resolve();
        });

        document.body.style.overflow = 'hidden';
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'showModalNotifyOnActiveTab') {
        showModalNotifyAT(message.messages, message.title).then(() => {
            sendResponse({ confirmed: true });
        });
        return true;
    }
});
