// Web Worker để tính toán hash của ảnh mà không làm đơ giao diện
self.onmessage = async (event) => {
    const { id, base64 } = event.data;
    try {
        // Chuyển chuỗi base64 thành một ArrayBuffer
        const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
        // Tính toán hash SHA-256
        const hashBuffer = await self.crypto.subtle.digest('SHA-256', buffer);
        // Chuyển hash thành một chuỗi hex
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        // Gửi kết quả (hash và id gốc) trở lại luồng chính
        self.postMessage({ id, hash: hashHex });
    } catch (error) {
        // Gửi lỗi trở lại
        self.postMessage({ id, error: error.message });
    }
};
