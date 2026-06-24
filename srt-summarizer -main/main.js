const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 900,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        title: 'SRT Summarizer'
    });

    mainWindow.loadFile('index.html');
}

// Check if text is primarily Chinese
function isChinese(text) {
    const chineseChars = text.match(/[\u4e00-\u9fff]/g) || [];
    return chineseChars.length > text.length * 0.3;
}

// Check if text is primarily English
function isEnglish(text) {
    const englishChars = text.match(/[a-zA-Z]/g) || [];
    return englishChars.length > text.length * 0.5;
}

// Parse SRT file and separate Chinese/English content
function parseSRTBilingual(content) {
    const blocks = content.trim().split(/\n\n+/);
    let chineseText = [];
    let englishText = [];

    for (const block of blocks) {
        const lines = block.split('\n');
        
        // Skip index and timecode lines
        const textLines = lines.filter(line => {
            // Skip empty lines, numbers, and timecodes
            if (!line.trim()) return false;
            if (/^\d+$/.test(line.trim())) return false;
            if (/\d{2}:\d{2}:\d{2}/.test(line)) return false;
            return true;
        });

        for (const line of textLines) {
            const cleanLine = line.replace(/<[^>]+>/g, '').trim();
            if (!cleanLine) continue;

            if (isChinese(cleanLine)) {
                chineseText.push(cleanLine);
            } else if (isEnglish(cleanLine)) {
                englishText.push(cleanLine);
            } else {
                // Mixed or unknown - check first char
                const firstChar = cleanLine.charCodeAt(0);
                if (firstChar >= 0x4e00 && firstChar <= 0x9fff) {
                    chineseText.push(cleanLine);
                } else {
                    englishText.push(cleanLine);
                }
            }
        }
    }

    return {
        chinese: chineseText.join(' '),
        english: englishText.join(' '),
        hasChinese: chineseText.length > 0,
        hasEnglish: englishText.length > 0
    };
}

// Call MiniMax API for summarization
function callMiniMax(text, apiKey, groupId, language) {
    return new Promise((resolve, reject) => {
        const systemPrompt = language === 'chinese' 
            ? '你是一个专业的字幕内容摘要助手。请总结用户提供的字幕内容，提取最重要的信息，用简洁的中文输出摘要，突出关键要点。'
            : 'You are a professional subtitle summarization assistant. Summarize the following subtitle content, extract the most important information, and provide a concise summary in English, highlighting key points.';

        const userPrompt = language === 'chinese'
            ? `请总结以下字幕内容，提取最重要的信息，用简洁的中文输出摘要：\n\n${text}`
            : `Please summarize the following subtitle content, extract the most important information, and provide a concise summary in English:\n\n${text}`;

        const postData = JSON.stringify({
            model: "MiniMax-Text-01",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.7,
            max_tokens: 2048
        });

        const options = {
            hostname: 'api.minimax.chat',
            port: 443,
            path: `/v1/text/chatcompletion_v2?GroupId=${groupId}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
                        resolve(parsed.choices[0].message.content);
                    } else if (parsed.base_resp && parsed.base_resp.status_msg) {
                        reject(new Error(parsed.base_resp.status_msg));
                    } else {
                        reject(new Error('Invalid response from MiniMax API'));
                    }
                } catch (e) {
                    reject(new Error('Failed to parse response: ' + e.message));
                }
            });
        });

        req.on('error', (e) => {
            reject(new Error(`API connection error: ${e.message}`));
        });

        req.write(postData);
        req.end();
    });
}

ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'SRT Files', extensions: ['srt'] }]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseSRTBilingual(content);
        return { filePath, ...parsed };
    }
    return null;
});

ipcMain.handle('summarize', async (event, { content, apiKey, groupId, language }) => {
    try {
        const summary = await callMiniMax(content, apiKey, groupId, language);
        return { success: true, summary };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-summary', async (event, { summary }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: 'summary.txt',
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
    });

    if (!result.canceled) {
        fs.writeFileSync(result.filePath, summary, 'utf-8');
        return true;
    }
    return false;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
