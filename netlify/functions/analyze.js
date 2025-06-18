// File: netlify/functions/analyze.js

// Dùng 'node-fetch' để gọi API từ backend. Cần cài đặt nó.
// Hãy chạy lệnh: npm init -y && npm install node-fetch@2
const fetch = require('node-fetch');

exports.handler = async function (event, context) {
  // Chỉ cho phép phương thức POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Lấy API Key từ biến môi trường đã lưu trên Netlify
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        throw new Error('API Key không được thiết lập trên Netlify.');
    }

    // URL của Google Gemini API
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    // Lấy nội dung mà trình duyệt gửi lên (chính là object { contents: [...] })
    const requestBody = JSON.parse(event.body);

    // Gọi đến API của Gemini từ server của Netlify
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody), // Gửi tiếp nội dung nhận được
    });

    if (!response.ok) {
      const errorData = await response.json();
      // Trả lỗi về cho trình duyệt
      return {
        statusCode: response.status,
        body: JSON.stringify(errorData),
      };
    }

    const data = await response.json();

    // Trả kết quả thành công về cho trình duyệt
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
