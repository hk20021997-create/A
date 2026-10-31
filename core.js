/**
 * Core OCR & Document Processing Module
 */

class DocumentProcessor {
    static parseDocument(imageElement) {
        // Pre-processing helper for Canvas rendering
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = imageElement.naturalWidth || imageElement.width;
        canvas.height = imageElement.naturalHeight || imageElement.height;
        ctx.drawImage(imageElement, 0, 0);

        return {
            canvas: canvas,
            width: canvas.width,
            height: canvas.height
        };
    }

    static formatDetails(dataObj) {
        let html = '<ul class="list-group list-group-flush">';
        for (const [key, value] of Object.entries(dataObj)) {
            html += `
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    <span class="data-label">${key}</span>
                    <span>${value}</span>
                </li>
            `;
        }
        html += '</ul>';
        return html;
    }
}
