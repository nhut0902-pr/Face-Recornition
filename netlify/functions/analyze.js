// netlify/functions/analyze.js

exports.handler = async function (event, context) {
    // Chỉ cho phép yêu cầu POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // Lấy API key từ Biến Môi trường (an toàn trên Netlify)
        const API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

        if (!API_KEY) {
            return { statusCode: 500, body: JSON.stringify({ error: 'API Key chưa được cấu hình trên server.' }) };
        }

        // Parse dữ liệu 'parts' từ body của request mà frontend gửi lên
        const { parts } = JSON.parse(event.body);

        if (!parts) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Không có dữ liệu "parts" để phân tích.' }) };
        }

        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`;
        
        const geminiResponse = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: {
                    response_mime_type: "application/json",
                }
            })
        });

        if (!geminiResponse.ok) {
            const errorData = await geminiResponse.json();
            throw new Error(errorData.error.message);
        }

        const data = await geminiResponse.json();

        // Trả kết quả thành công về lại cho frontend
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        };

    } catch (error) {
        console.error('Lỗi trong Netlify Function:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: `Lỗi Serverless Function: ${error.message}` })
        };
    }
};
