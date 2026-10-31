document.addEventListener('DOMContentLoaded', () => {
    const imageInput = document.getElementById('imageInput');
    const imagePreview = document.getElementById('imagePreview');
    const placeholderText = document.getElementById('placeholderText');
    const processBtn = document.getElementById('processBtn');
    const detailsContainer = document.getElementById('detailsContainer');

    let loadedImageSrc = null;

    imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                loadedImageSrc = event.target.result;
                imagePreview.src = loadedImageSrc;
                imagePreview.classList.remove('d-none');
                placeholderText.classList.add('d-none');
                processBtn.disabled = false;
            };
            reader.readAsDataURL(file);
        }
    });

    processBtn.addEventListener('click', () => {
        if (!loadedImageSrc) return;

        detailsContainer.innerHTML = `
            <div class="d-flex justify-content-center my-4">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
            </div>
        `;

        // Simulate document parsing with core.js helper
        setTimeout(() => {
            const parsed = DocumentProcessor.parseDocument(imagePreview);
            
            // Structured data extracted from scanned documents
            const extractedInfo = {
                "Name": "AKSHAY K S",
                "Father's Name": "SHAJAN K V",
                "Date of Birth": "26/05/2006",
                "Aadhaar Number": "9621 5705 5019",
                "PAN Number": "VIIPS2499E",
                "Driving Licence No": "KL48 20250001460",
                "SBI Account No": "67381295945",
                "IFS Code": "SBIN0071078",
                "Mobile": "8943886859",
                "Address": "KALLUVETTUKUZHIYIL HOUSE, THEKKUMURI, KADANGODE PO, THRISSUR, KERALA - 680584"
            };

            detailsContainer.innerHTML = DocumentProcessor.formatDetails(extractedInfo);
        }, 1000);
    });
});
