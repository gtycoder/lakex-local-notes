package com.lakenotes.mobile;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * 「新建小记」的**原生秒开**输入框：长按桌面快捷方式直接开它，**不走 WebView / Lake 内核**，
 * 冷启动只等一个原生 Activity（比 WebView 快）。
 *
 * 提交写 `filesDir/quick-capture-inbox/&lt;uuid&gt;.txt`（UTF-8 纯文本），
 * App 启动/回前台时由 JS {@code src/mobile/quickCaptureInbox.ts} 导入为小记并删除文件。
 * 草稿存 SharedPreferences：写到一半被系统杀进程也能恢复（对齐思源闪念的"不丢"）。
 */
public class QuickCaptureActivity extends Activity {

    private static final String PREFS = "quick_capture";
    private static final String DRAFT_KEY = "draft";
    private static final String INBOX = "quick-capture-inbox";

    private EditText input;
    private boolean committed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_quick_capture);
        input = findViewById(R.id.quick_capture_input);

        final SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String draft = prefs.getString(DRAFT_KEY, "");
        if (draft != null && !draft.isEmpty()) {
            input.setText(draft);
            input.setSelection(input.getText().length());
        }
        input.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                prefs.edit().putString(DRAFT_KEY, s == null ? "" : s.toString()).apply();
            }
            @Override public void afterTextChanged(Editable s) { }
        });

        findViewById(R.id.quick_capture_cancel).setOnClickListener(v -> {
            committed = true;
            prefs.edit().remove(DRAFT_KEY).apply();
            finish();
        });
        findViewById(R.id.quick_capture_save).setOnClickListener(v -> {
            String text = input.getText().toString().trim();
            committed = true;
            if (!text.isEmpty()) writeInbox(text);
            prefs.edit().remove(DRAFT_KEY).apply();
            finish();
        });

        input.requestFocus();
        input.postDelayed(() -> {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT);
        }, 120);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // 提交/取消后不再回写草稿（否则会把刚清掉的草稿又写回来）
        if (!committed) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(DRAFT_KEY, input.getText().toString()).apply();
        }
    }

    private void writeInbox(String text) {
        try {
            File dir = new File(getFilesDir(), INBOX);
            if (!dir.exists() && !dir.mkdirs()) return;
            File out = new File(dir, UUID.randomUUID().toString().replace("-", "") + ".txt");
            try (FileOutputStream os = new FileOutputStream(out)) {
                os.write(text.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) { }
    }
}
