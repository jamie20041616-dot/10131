// ==================== 雲端與本地題庫設定 ====================
// 請將下方 GOOGLE_SHEET_CSV_URL 填入你的 Google 試算表「發布到網路 (.csv)」網址（或共用連結）：
// 【Google 試算表設定步驟】
// 1. 第一列標題列請設為：question, optionA, optionB, optionC, optionD, answer
// 2. 點選試算表左上角「檔案」➔「共用」➔「發布到網路」
// 3. 將格式由「網頁」改為「逗號分隔值 (.csv)」，點擊「發布」並複製連結貼到下方字串中
// （若留空或網路無法連線，系統會自動使用本地的 questions.csv 作為備用題庫）
const GOOGLE_SHEET_CSV_URL = "";

const BACKUP_CSV_FILE = "questions.csv"; // 本地備用題庫
const QUIZ_QUESTION_COUNT = 5;           // 每次隨機抽出的題數

let cloudTable = null;        // Google 試算表 CSV 表格物件
let backupTable = null;       // 本地備用 questions.csv 表格物件
let isCloudLoaded = false;    // 是否成功載入雲端題庫
let questionSourceText = "";  // 顯示目前題庫來源狀態
let allQuestions = [];        // 完整題庫陣列
let questions = [];           // 本次測驗隨機抽出的 5 題

// Google Fonts 字型設定（英文字型：Bitcount Ink，中文字型：ZCOOL QingKe HuangYou）
const ENGLISH_FONT = "Bitcount Ink";
const CHINESE_FONT = "ZCOOL QingKe HuangYou";
const QUESTION_FONT = '"Bitcount Ink", "ZCOOL QingKe HuangYou", sans-serif'; // 題目與標題字型
const OPTION_FONT = '"Bitcount Ink", "ZCOOL QingKe HuangYou", sans-serif';   // 選項與介面字型

let currentQuestionIndex = 0; // 目前題號
let score = 0;                // 總得分
let selectedOption = -1;      // 使用者選擇的選項 (-1 表示尚未作答)
let isAnswered = false;       // 該題是否已作答
let quizFinished = false;     // 測驗是否結束
let userAnswers = [];         // 紀錄每題作答結果

// 介面按鈕區域紀錄（用於滑鼠點擊與觸控偵測）
let optionButtons = [];
let nextButton = { x: 0, y: 0, w: 150, h: 44 };
let restartButton = { x: 0, y: 0, w: 200, h: 48 };
let lastPressTime = 0;        // 防止行動裝置觸控與滑鼠事件重複觸發
let isTouchActive = false;    // 判斷是否為觸控操作（避免手機上殘留懸停狀態）

// 將 Google 試算表網址正規化為可直接讀取的 CSV 網址（並加上時間戳記確保讀取最新內容）
function getGoogleSheetCsvUrl(rawUrl) {
  if (!rawUrl || !rawUrl.trim()) return "";
  let url = rawUrl.trim();

  // 若使用者貼的是一般試算表編輯/共用網址，自動轉換為 export?format=csv 匯出網址
  if (url.includes("docs.google.com/spreadsheets/d/") && !url.includes("/d/e/") && !url.includes("output=csv") && !url.includes("format=csv")) {
    let match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      let gidMatch = url.match(/[#&?]gid=([0-9]+)/);
      let gidParam = gidMatch ? `&gid=${gidMatch[1]}` : "";
      url = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv${gidParam}`;
    }
  }

  // 加上時間戳記避免瀏覽器快取舊題目，讓老師修改試算表後重新整理即可看到最新題目
  let separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_t=${Date.now()}`;
}

// 在程式開始前預先載入題庫（優先嘗試 Google 試算表，同時載入本地 questions.csv 作為備用）
function preload() {
  backupTable = loadTable(BACKUP_CSV_FILE, "csv", "header");

  let sheetCsvUrl = getGoogleSheetCsvUrl(GOOGLE_SHEET_CSV_URL);
  if (sheetCsvUrl) {
    cloudTable = loadTable(
      sheetCsvUrl,
      "csv",
      "header",
      () => {
        isCloudLoaded = true;
      },
      () => {
        console.warn("無法讀取 Google 試算表，已自動切換為本地備用題庫 questions.csv");
        isCloudLoaded = false;
      }
    );
  }
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont(OPTION_FONT);

  // 優先解析 Google 試算表題庫；若未設定或無有效題目則使用本地備用題庫 questions.csv
  initQuestionBank();
  pickRandomQuestions();
}

function initQuestionBank() {
  if (isCloudLoaded && cloudTable) {
    let cloudQuestions = parseTableToQuestions(cloudTable);
    if (cloudQuestions.length > 0) {
      allQuestions = cloudQuestions;
      questionSourceText = "☁️ 雲端題庫 (Google 試算表)";
      return;
    }
  }

  // 使用備用題庫 questions.csv
  allQuestions = parseTableToQuestions(backupTable);
  questionSourceText = "📁 備用題庫 (questions.csv)";
}

// 將 p5.Table 表格資料轉換為題目陣列
function parseTableToQuestions(tableObj) {
  let parsed = [];
  if (!tableObj) return parsed;

  let answerMap = { A: 0, B: 1, C: 2, D: 3, "0": 0, "1": 1, "2": 2, "3": 3, "1": 1 };

  for (let r = 0; r < tableObj.getRowCount(); r++) {
    let row = tableObj.getRow(r);
    let qText = (row.getString("question") || "").trim();
    if (!qText) continue;

    let opts = [
      (row.getString("optionA") || "").trim(),
      (row.getString("optionB") || "").trim(),
      (row.getString("optionC") || "").trim(),
      (row.getString("optionD") || "").trim()
    ];

    let rawAns = (row.getString("answer") || "").trim().toUpperCase();
    let ansIndex = answerMap[rawAns] !== undefined ? answerMap[rawAns] : 0;

    parsed.push({
      question: qText,
      options: opts,
      answer: ansIndex
    });
  }
  return parsed;
}

// 從完整題庫中隨機洗牌並抽出 5 題
function pickRandomQuestions() {
  let shuffled = shuffle(allQuestions);
  let count = min(QUIZ_QUESTION_COUNT, shuffled.length);
  questions = shuffled.slice(0, count);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function draw() {
  // 確保行動裝置旋轉螢幕時畫布尺寸即時同步
  if (width !== windowWidth || height !== windowHeight) {
    resizeCanvas(windowWidth, windowHeight);
  }

  background(240, 244, 248);

  if (questions.length === 0) {
    fill(100, 116, 139);
    textFont(OPTION_FONT);
    textSize(20);
    textAlign(CENTER, CENTER);
    text("題庫載入中，請透過本地伺服器（如 Live Server）開啟網頁...", width / 2, height / 2);
    return;
  }

  if (!quizFinished) {
    drawQuizScreen();
  } else {
    drawResultScreen();
  }
}

// ==================== 繪製測驗畫面（響應式版面） ====================
function drawQuizScreen() {
  let q = questions[currentQuestionIndex];

  // 判斷螢幕方向與裝置型態
  let isCompactLandscape = (width > height && height < 540);
  let isNarrowPortrait = (width < 500 && !isCompactLandscape);

  // 根據視窗大小動態計算外距與卡片尺寸
  let margin = isCompactLandscape ? 10 : (width < 600 ? 12 : 24);
  let maxCardW = isCompactLandscape ? 840 : 720;
  let maxCardH = isCompactLandscape ? 460 : 600;

  let cardW = min(maxCardW, width - margin * 2);
  let cardH = min(maxCardH, height - margin * 2);
  let cardX = (width - cardW) / 2;
  let cardY = (height - cardH) / 2;

  let padX = constrain(cardW * 0.045, 14, 36);
  let padY = constrain(cardH * 0.04, 12, 28);
  let contentX = cardX + padX;
  let contentW = cardW - padX * 2;

  // 卡片陰影與背景
  noStroke();
  fill(0, 0, 0, 18);
  rect(cardX + 3, cardY + 5, cardW, cardH, 18);
  fill(255);
  rect(cardX, cardY, cardW, cardH, 18);

  let curY = cardY + padY;

  // 1. 頂部進度條
  let barH = isCompactLandscape ? 6 : 8;
  fill(226, 232, 240);
  rect(contentX, curY, contentW, barH, barH / 2);

  let progressRatio = (currentQuestionIndex + 1) / questions.length;
  fill(59, 130, 246);
  rect(contentX, curY, contentW * progressRatio, barH, barH / 2);
  curY += barH + (isCompactLandscape ? 8 : 12);

  // 2. 題號、題庫來源與目前得分
  let metaFontSize = constrain(min(cardW, cardH) * 0.032, 12, 16);
  fill(100, 116, 139);
  textFont(OPTION_FONT);
  textSize(metaFontSize);
  textStyle(BOLD);
  textAlign(LEFT, TOP);
  let progressLabel = width >= 520
    ? `第 ${currentQuestionIndex + 1} 題 / 共 ${questions.length} 題  ｜  ${questionSourceText}`
    : `第 ${currentQuestionIndex + 1} / ${questions.length} 題`;
  text(progressLabel, contentX, curY);

  textAlign(RIGHT, TOP);
  text(`目前得分：${score} 分`, contentX + contentW, curY);
  curY += metaFontSize + (isCompactLandscape ? 8 : 16);

  // 3. 計算底部回饋與按鈕預留區高度
  let footerH = isNarrowPortrait ? 78 : (isCompactLandscape ? 40 : 50);
  let optionsBottomY = cardY + cardH - padY - footerH - (isCompactLandscape ? 6 : 12);

  // 4. 題目文字區（使用 Google Fonts 繁體中文字型 QUESTION_FONT）
  let qFontSize = constrain(min(cardW * 0.042, cardH * 0.044), 15, 22);
  let questionH = isCompactLandscape
    ? constrain(cardH * 0.16, 36, 56)
    : constrain(cardH * 0.15, 48, 82);

  fill(30, 41, 59);
  textFont(QUESTION_FONT);
  textSize(qFontSize);
  textStyle(BOLD);
  textAlign(LEFT, TOP);
  text(q.question, contentX, curY, contentW, questionH);
  curY += questionH + (isCompactLandscape ? 4 : 8);

  // 5. 繪製四個選項按鈕（使用 Google Fonts 繁體中文字型 OPTION_FONT）
  textFont(OPTION_FONT);
  let availOptH = max(90, optionsBottomY - curY);
  let useGrid = isCompactLandscape || (availOptH < 190 && contentW >= 420);
  let cols = useGrid ? 2 : 1;
  let rows = useGrid ? 2 : 4;

  let gapX = useGrid ? 12 : 0;
  let gapY = useGrid
    ? constrain(availOptH * 0.08, 6, 12)
    : constrain(availOptH * 0.045, 6, 14);

  let btnW = (contentW - gapX * (cols - 1)) / cols;
  let btnH = min(58, (availOptH - gapY * (rows - 1)) / rows);

  optionButtons = [];
  let labels = ["A", "B", "C", "D"];
  let hoveringAny = false;

  for (let i = 0; i < 4; i++) {
    let col = i % cols;
    let row = Math.floor(i / cols);
    let bx = contentX + col * (btnW + gapX);
    let by = curY + row * (btnH + gapY);

    let btn = { x: bx, y: by, w: btnW, h: btnH, index: i };
    optionButtons.push(btn);

    let isHover = !isTouchActive && !isAnswered && isMouseInside(btn);
    if (isHover) hoveringAny = true;

    // 決定選項按鈕配色
    let bgCol = color(248, 250, 252);
    let borderCol = color(203, 213, 225);
    let textCol = color(51, 65, 85);

    if (!isAnswered) {
      if (isHover) {
        bgCol = color(239, 246, 255);
        borderCol = color(59, 130, 246);
      }
    } else {
      if (i === q.answer) {
        bgCol = color(220, 252, 231);
        borderCol = color(34, 197, 94);
        textCol = color(21, 128, 61);
      } else if (i === selectedOption && selectedOption !== q.answer) {
        bgCol = color(254, 226, 226);
        borderCol = color(239, 68, 68);
        textCol = color(185, 28, 28);
      }
    }

    stroke(borderCol);
    strokeWeight(2);
    fill(bgCol);
    rect(btn.x, btn.y, btn.w, btn.h, 10);

    // 選項代號圓圈 (A/B/C/D)
    let badgeR = constrain(btn.h * 0.56, 22, 32);
    let badgeCenterX = btn.x + badgeR * 0.8 + 6;
    let badgeCenterY = btn.y + btn.h / 2;

    noStroke();
    if (isAnswered && i === q.answer) {
      fill(34, 197, 94);
    } else if (isAnswered && i === selectedOption && selectedOption !== q.answer) {
      fill(239, 68, 68);
    } else if (isHover) {
      fill(59, 130, 246);
    } else {
      fill(226, 232, 240);
    }
    circle(badgeCenterX, badgeCenterY, badgeR);

    // 代號文字
    if ((isAnswered && (i === q.answer || i === selectedOption)) || isHover) {
      fill(255);
    } else {
      fill(71, 85, 105);
    }
    let badgeFontSize = constrain(badgeR * 0.5, 12, 16);
    textFont(ENGLISH_FONT);
    textSize(badgeFontSize);
    textStyle(BOLD);
    textAlign(CENTER, CENTER);
    text(labels[i], badgeCenterX, badgeCenterY);

    // 右側對錯標記寬度預留
    let statusTag = "";
    if (isAnswered) {
      let showFullTag = btn.w >= 260;
      if (i === q.answer) {
        statusTag = showFullTag ? "✓ 正確" : "✓";
      } else if (i === selectedOption) {
        statusTag = showFullTag ? "✗ 錯誤" : "✗";
      }
    }

    // 選項內容文字（使用 OPTION_FONT）
    let optFontSize = constrain(min(btn.h * 0.34, btn.w * 0.065), 13, 18);
    textFont(OPTION_FONT);
    textSize(optFontSize);
    textStyle(NORMAL);
    fill(textCol);
    textAlign(LEFT, CENTER);

    let textStartX = badgeCenterX + badgeR / 2 + 10;
    let rightReserved = statusTag ? (btn.w >= 260 ? 72 : 32) : 12;
    let maxOptTextW = max(40, btn.w - (textStartX - btn.x) - rightReserved);
    let displayOptText = truncateText(q.options[i], maxOptTextW);
    text(displayOptText, textStartX, badgeCenterY);

    // 繪製右側 ✓ 或 ✗ 標記
    if (statusTag) {
      textAlign(RIGHT, CENTER);
      textSize(optFontSize * 0.95);
      textStyle(BOLD);
      fill(i === q.answer ? color(21, 128, 61) : color(185, 28, 28));
      text(statusTag, btn.x + btn.w - 12, badgeCenterY);
    }
  }

  // 6. 底部回饋訊息與「下一題 / 查看總分」按鈕
  let footerTopY = cardY + cardH - padY - footerH;
  textFont(OPTION_FONT);
  if (!isAnswered) {
    fill(148, 163, 184);
    textSize(constrain(metaFontSize, 12, 15));
    textStyle(NORMAL);
    textAlign(CENTER, CENTER);
    text("請點擊任一選項作答", contentX + contentW / 2, footerTopY + footerH / 2);
  } else {
    let pointsPerQuestion = Math.round(100 / questions.length);
    let correctLabel = labels[q.answer];
    let feedbackStr = selectedOption === q.answer
      ? `🎉 答對了！+${pointsPerQuestion} 分`
      : `❌ 答錯了！正解：(${correctLabel}) ${q.options[q.answer]}`;
    let feedbackCol = selectedOption === q.answer ? color(22, 163, 74) : color(220, 38, 38);
    let btnLabel = currentQuestionIndex < questions.length - 1 ? "下一題 ➔" : "查看總分 ➔";

    if (isNarrowPortrait) {
      // 手機直向窄螢幕：上方顯示對錯回饋，下方顯示滿版按鈕，避免文字與按鈕重疊
      fill(feedbackCol);
      textSize(constrain(cardW * 0.042, 14, 17));
      textStyle(BOLD);
      textAlign(CENTER, TOP);
      text(truncateText(feedbackStr, contentW), contentX + contentW / 2, footerTopY + 2);

      nextButton.w = contentW;
      nextButton.h = 42;
      nextButton.x = contentX;
      nextButton.y = footerTopY + footerH - nextButton.h;
    } else {
      // 電腦、平板與手機橫向：左側顯示對錯回饋，右側顯示按鈕
      nextButton.w = isCompactLandscape ? 136 : 152;
      nextButton.h = isCompactLandscape ? 36 : 44;
      nextButton.x = contentX + contentW - nextButton.w;
      nextButton.y = footerTopY + (footerH - nextButton.h) / 2;

      fill(feedbackCol);
      textSize(isCompactLandscape ? 15 : 18);
      textStyle(BOLD);
      textAlign(LEFT, CENTER);
      let maxFeedbackW = contentW - nextButton.w - 14;
      text(truncateText(feedbackStr, maxFeedbackW), contentX, footerTopY + footerH / 2);
    }

    let isNextHover = !isTouchActive && isMouseInside(nextButton);
    if (isNextHover) hoveringAny = true;

    noStroke();
    fill(isNextHover ? color(37, 99, 235) : color(59, 130, 246));
    rect(nextButton.x, nextButton.y, nextButton.w, nextButton.h, 10);

    fill(255);
    textSize(isCompactLandscape ? 14 : 16);
    textStyle(BOLD);
    textAlign(CENTER, CENTER);
    text(btnLabel, nextButton.x + nextButton.w / 2, nextButton.y + nextButton.h / 2);
  }

  cursor(hoveringAny ? HAND : ARROW);
}

// ==================== 繪製結算畫面（響應式版面） ====================
function drawResultScreen() {
  let isCompactLandscape = (width > height && height < 540);
  let margin = isCompactLandscape ? 10 : (width < 600 ? 12 : 24);
  let maxCardW = isCompactLandscape ? 860 : 740;
  let maxCardH = isCompactLandscape ? 460 : 640;

  let cardW = min(maxCardW, width - margin * 2);
  let cardH = min(maxCardH, height - margin * 2);
  let cardX = (width - cardW) / 2;
  let cardY = (height - cardH) / 2;

  let padX = constrain(cardW * 0.04, 14, 32);
  let padY = constrain(cardH * 0.04, 12, 28);

  // 卡片陰影與背景
  noStroke();
  fill(0, 0, 0, 18);
  rect(cardX + 3, cardY + 5, cardW, cardH, 18);
  fill(255);
  rect(cardX, cardY, cardW, cardH, 18);

  let correctCount = userAnswers.filter(a => a.isCorrect).length;
  let comment = score === 100 ? "太厲害了！全對滿分！🏆" :
                score >= 60 ? "表現不錯喔！繼續保持！👍" : "再接再厲，再挑戰一次！💪";
  let labels = ["A", "B", "C", "D"];

  let listX, listY, listW, listH;

  if (isCompactLandscape) {
    // 手機橫向模式：左欄顯示總分與重測按鈕，右欄顯示各題對錯明細
    let leftW = cardW * 0.36;
    let leftCenterX = cardX + padX + leftW / 2;
    let centerY = cardY + cardH / 2;

    fill(30, 41, 59);
    textFont(QUESTION_FONT);
    textSize(constrain(cardH * 0.065, 18, 24));
    textStyle(BOLD);
    textAlign(CENTER, CENTER);
    text("測驗結果公佈", leftCenterX, centerY - cardH * 0.28);

    fill(59, 130, 246);
    textFont(OPTION_FONT);
    textSize(constrain(cardH * 0.11, 28, 42));
    textStyle(BOLD);
    text(`${score} / 100 分`, leftCenterX, centerY - cardH * 0.1);

    fill(100, 116, 139);
    textSize(constrain(cardH * 0.042, 12, 15));
    textStyle(NORMAL);
    text(`答對 ${correctCount} / ${questions.length} 題`, leftCenterX, centerY + cardH * 0.05);
    text(comment, leftCenterX, centerY + cardH * 0.14);

    restartButton.w = min(leftW - 10, 180);
    restartButton.h = constrain(cardH * 0.12, 36, 46);
    restartButton.x = leftCenterX - restartButton.w / 2;
    restartButton.y = centerY + cardH * 0.24;

    listX = cardX + padX + leftW + 14;
    listY = cardY + padY;
    listW = cardW - (listX - cardX) - padX;
    listH = cardH - padY * 2;
  } else {
    // 電腦、平板、手機直向模式：上下單欄排版
    let centerX = width / 2;
    let curY = cardY + padY;

    let titleSize = constrain(min(cardW * 0.055, cardH * 0.045), 20, 28);
    fill(30, 41, 59);
    textFont(QUESTION_FONT);
    textSize(titleSize);
    textStyle(BOLD);
    textAlign(CENTER, TOP);
    text("測驗結果公佈", centerX, curY);
    curY += titleSize + (cardH < 520 ? 6 : 10);

    let scoreSize = constrain(min(cardW * 0.09, cardH * 0.07), 28, 46);
    fill(59, 130, 246);
    textFont(OPTION_FONT);
    textSize(scoreSize);
    textStyle(BOLD);
    text(`${score} / 100 分`, centerX, curY);
    curY += scoreSize + (cardH < 520 ? 6 : 10);

    let commentSize = constrain(min(cardW * 0.036, cardH * 0.028), 13, 17);
    fill(100, 116, 139);
    textSize(commentSize);
    textStyle(NORMAL);
    let summaryStr = width < 420
      ? `答對 ${correctCount}/${questions.length} 題｜${comment}`
      : `共答對 ${correctCount} / ${questions.length} 題 —— ${comment}`;
    text(summaryStr, centerX, curY);
    curY += commentSize + (cardH < 520 ? 10 : 16);

    restartButton.w = min(contentWidthOrDefault(cardW, padX), 210);
    restartButton.h = constrain(cardH * 0.075, 40, 50);
    restartButton.x = centerX - restartButton.w / 2;
    restartButton.y = cardY + cardH - padY - restartButton.h;

    listX = cardX + padX;
    listY = curY;
    listW = cardW - padX * 2;
    listH = restartButton.y - listY - (cardH < 520 ? 10 : 16);
  }

  // 繪製各題作答對錯明細列表（自動依可用高度縮放每列高度）
  let rowGap = constrain(listH * 0.025, 4, 8);
  let rowH = max(36, (listH - rowGap * (questions.length - 1)) / questions.length);

  for (let i = 0; i < questions.length; i++) {
    let ans = userAnswers[i];
    let q = questions[i];
    let ry = listY + i * (rowH + rowGap);

    noStroke();
    fill(ans.isCorrect ? color(240, 253, 244) : color(254, 242, 242));
    rect(listX, ry, listW, rowH, 8);

    let titleFontSize = constrain(min(rowH * 0.3, listW * 0.036), 11, 15);
    let subFontSize = constrain(min(rowH * 0.26, listW * 0.032), 10, 13);

    // 對錯標籤
    fill(ans.isCorrect ? color(22, 163, 74) : color(220, 38, 38));
    textFont(OPTION_FONT);
    textSize(titleFontSize);
    textStyle(BOLD);
    textAlign(LEFT, TOP);
    let statusText = ans.isCorrect ? "✓ 答對" : "✗ 答錯";
    let tagStr = `第 ${i + 1} 題 [${statusText}]`;
    text(tagStr, listX + 10, ry + rowH * 0.14);

    let tagW = textWidth(tagStr) + 18;

    // 題目簡述（使用 QUESTION_FONT，並自動截斷防止超出邊界）
    fill(51, 65, 85);
    textFont(QUESTION_FONT);
    textStyle(BOLD);
    textSize(titleFontSize);
    let maxQWidth = max(40, listW - tagW - 14);
    text(truncateText(q.question, maxQWidth), listX + tagW, ry + rowH * 0.14);

    // 使用者選擇與正確答案（使用 OPTION_FONT）
    fill(100, 116, 139);
    textFont(OPTION_FONT);
    textStyle(NORMAL);
    textSize(subFontSize);
    let userChoiceText = `你的答案：(${labels[ans.selected]}) ${q.options[ans.selected]}`;
    let correctChoiceText = ans.isCorrect ? "" : ` ｜ 正解：(${labels[q.answer]}) ${q.options[q.answer]}`;
    let fullSubText = truncateText(userChoiceText + correctChoiceText, listW - 20);
    text(fullSubText, listX + 10, ry + rowH * 0.56);
  }

  // 繪製重新開始測驗按鈕
  let isRestartHover = !isTouchActive && isMouseInside(restartButton);
  noStroke();
  fill(isRestartHover ? color(37, 99, 235) : color(59, 130, 246));
  rect(restartButton.x, restartButton.y, restartButton.w, restartButton.h, 10);

  fill(255);
  textSize(constrain(restartButton.h * 0.38, 14, 18));
  textStyle(BOLD);
  textAlign(CENTER, CENTER);
  text("🔄 重新開始測驗", restartButton.x + restartButton.w / 2, restartButton.y + restartButton.h / 2);

  cursor(isRestartHover ? HAND : ARROW);
}

// ==================== 滑鼠與觸控互動處理 ====================
function mouseMoved() {
  isTouchActive = false;
}

function mousePressed() {
  handlePointerInput(mouseX, mouseY);
}

function touchStarted() {
  isTouchActive = true;
  if (touches.length > 0) {
    handlePointerInput(touches[0].x, touches[0].y);
  } else {
    handlePointerInput(mouseX, mouseY);
  }
}

function handlePointerInput(px, py) {
  // 防止行動裝置同時觸發 touchStarted 與 mousePressed
  let now = millis();
  if (now - lastPressTime < 250) return;
  lastPressTime = now;

  if (!quizFinished) {
    if (!isAnswered) {
      for (let btn of optionButtons) {
        if (isPointInside(px, py, btn)) {
          selectOption(btn.index);
          break;
        }
      }
    } else {
      if (isPointInside(px, py, nextButton)) {
        goToNextQuestion();
      }
    }
  } else {
    if (isPointInside(px, py, restartButton)) {
      restartQuiz();
    }
  }
}

function selectOption(index) {
  selectedOption = index;
  isAnswered = true;

  let q = questions[currentQuestionIndex];
  let correct = (selectedOption === q.answer);
  let pointsPerQuestion = Math.round(100 / questions.length);

  if (correct) {
    score += pointsPerQuestion;
  }

  userAnswers.push({
    selected: selectedOption,
    isCorrect: correct
  });
}

function goToNextQuestion() {
  if (currentQuestionIndex < questions.length - 1) {
    currentQuestionIndex++;
    selectedOption = -1;
    isAnswered = false;
  } else {
    quizFinished = true;
  }
}

function restartQuiz() {
  let sheetCsvUrl = getGoogleSheetCsvUrl(GOOGLE_SHEET_CSV_URL);
  if (sheetCsvUrl) {
    // 重新向 Google 試算表抓取最新題庫，讓老師修改後無須重整網頁也能生效
    loadTable(
      sheetCsvUrl,
      "csv",
      "header",
      (newTable) => {
        let latestQuestions = parseTableToQuestions(newTable);
        if (latestQuestions.length > 0) {
          allQuestions = latestQuestions;
          questionSourceText = "☁️ 雲端題庫 (Google 試算表)";
        }
        resetQuizState();
      },
      () => {
        resetQuizState();
      }
    );
  } else {
    resetQuizState();
  }
}

function resetQuizState() {
  pickRandomQuestions();
  currentQuestionIndex = 0;
  score = 0;
  selectedOption = -1;
  isAnswered = false;
  quizFinished = false;
  userAnswers = [];
}

// ==================== 輔助函式 ====================
function isMouseInside(btn) {
  return isPointInside(mouseX, mouseY, btn);
}

function isPointInside(px, py, btn) {
  return (
    px >= btn.x &&
    px <= btn.x + btn.w &&
    py >= btn.y &&
    py <= btn.y + btn.h
  );
}

function contentWidthOrDefault(cardW, padX) {
  return cardW - padX * 2;
}

// 當文字過長時自動截斷並加上 "..."，確保在小螢幕不超出邊界
function truncateText(str, maxW) {
  if (textWidth(str) <= maxW) return str;
  let ellipsis = "...";
  let ellW = textWidth(ellipsis);
  let result = str;
  while (result.length > 0 && textWidth(result) + ellW > maxW) {
    result = result.slice(0, -1);
  }
  return result + ellipsis;
}

