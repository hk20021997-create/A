
.gradle/
build/
local.properties
.idea/

plugins {
    id("com.android.application") version "8.5.0" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}

org.gradle.jvmargs=-Xmx3g -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official

# UAN / ESI document scanner (Android, offline)

Reads Aadhaar, PAN, driving licence and bank-detail photos/PDFs on the phone, shows the
details for checking, and adds a row to your UAN-ESI Excel template.

## Get the APK without installing anything (GitHub does the build)

1. Make a free account at github.com and press **New repository** (name: uanscan, Private is fine).
2. On the new repository page choose **uploading an existing file** and drag in EVERYTHING from this folder
   (the folders `app`, the files `build.gradle.kts`, `settings.gradle.kts`, `gradle.properties`, `README.md`).
3. The hidden folder `.github` may not upload by drag-and-drop. Then press **Add file > Create new file**,
   type the name `.github/workflows/build.yml` and paste the contents of that file from this folder. Commit.
4. Open the **Actions** tab. A run called "Build APK" starts by itself (about 5-8 minutes).
5. When it shows a green tick, open it and download **UANScan-APK** at the bottom. Unzip it: `app-debug.apk`.
6. Copy the APK to the phone, open it, allow "install unknown apps" when asked.

## Using the app

1. **Choose template** - pick your Excel (the app works on its own copy, your original is never touched).
2. **Batch details** - client, sub-contractor, joining date, wages etc. Set once; used for every person.
3. **Select documents** - choose all photos/PDFs of one person together.
4. Check/correct the fields (red = looks wrong; the Aadhaar number is checked with its check digit), press **Save to Excel**.
5. Repeat for the next person. At the end press **Save Excel to phone**.

## Notes

- Text in the photos is read by Google ML Kit, bundled inside the app, so no internet is needed. Needs Android 8.0 or newer.
- Handwritten text (e.g. father's date of birth, qualification) is not reliably read - type those on the check screen.
- Present and permanent address, nominee and family member 1 are all filled from the Aadhaar address / father's name; edit in Excel if different.
- New rows copy the formatting of the last filled row. SL NO continues from the last row.

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "UANScan"
include(":app")

name: Build APK
on:
  push:
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17
      - uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: 8.7
      - name: Build debug APK
        run: gradle assembleDebug --no-daemon
      - uses: actions/upload-artifact@v4
        with:
          name: UANScan-APK
          path: app/build/outputs/apk/debug/app-debug.apk

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.hrtools.uanscan"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.hrtools.uanscan"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    // Text recognition model is bundled inside the app, so it works with no internet.
    implementation("com.google.mlkit:text-recognition:16.0.0")
}

package com.hrtools.uanscan;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Adds one row to the first sheet of an .xlsx file by editing the sheet XML directly.
 * Everything else in the file (merged headers, widths, colours, hidden columns) stays exactly as it was,
 * and the new row copies the cell styles of the last filled row.
 */
public final class XlsxWriter {
    private XlsxWriter() {}

    public static final class Info {
        public int lastRow;   // last row that has an employee name
        public int serial;    // SL NO of that row (or count)
        public String sheetName = "";
    }

    private static final Pattern ROW = Pattern.compile("<row\\b[^>]*?(?:/>|>.*?</row>)", Pattern.DOTALL);
    private static final Pattern ROW_NUM = Pattern.compile("^<row\\b[^>]*?\\br=\"(\\d+)\"");
    private static final Pattern CELL = Pattern.compile("<c\\b[^>]*?(?:/>|>.*?</c>)", Pattern.DOTALL);

    private static Map<String, byte[]> readZip(File f) throws IOException {
        Map<String, byte[]> m = new LinkedHashMap<>();
        try (ZipInputStream z = new ZipInputStream(new FileInputStream(f))) {
            ZipEntry e;
            byte[] buf = new byte[8192];
            while ((e = z.getNextEntry()) != null) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                int n;
                while ((n = z.read(buf)) > 0) bo.write(buf, 0, n);
                m.put(e.getName(), bo.toByteArray());
            }
        }
        return m;
    }

    private static String attr(String tag, String name) {
        Matcher m = Pattern.compile("\\b" + name + "=\"([^\"]*)\"").matcher(tag);
        return m.find() ? m.group(1) : null;
    }

    private static String sheetPath(Map<String, byte[]> z) throws IOException {
        byte[] wb = z.get("xl/workbook.xml");
        byte[] rel = z.get("xl/_rels/workbook.xml.rels");
        if (wb == null || rel == null) throw new IOException("Not a valid Excel (.xlsx) file");
        String wbs = new String(wb, StandardCharsets.UTF_8);
        Matcher sm = Pattern.compile("<sheet\\b[^>]*>").matcher(wbs);
        if (!sm.find()) throw new IOException("No sheet found in the workbook");
        String rid = attr(sm.group(), "r:id");
        String rels = new String(rel, StandardCharsets.UTF_8);
        Matcher rm = Pattern.compile("<Relationship\\b[^>]*>").matcher(rels);
        while (rm.find()) {
            String tag = rm.group();
            if (rid != null && rid.equals(attr(tag, "Id"))) {
                String t = attr(tag, "Target");
                if (t == null) break;
                return t.startsWith("/") ? t.substring(1) : "xl/" + t;
            }
        }
        throw new IOException("Could not locate the first sheet");
    }

    private static String sheetName(Map<String, byte[]> z) {
        String wbs = new String(z.get("xl/workbook.xml"), StandardCharsets.UTF_8);
        Matcher sm = Pattern.compile("<sheet\\b[^>]*>").matcher(wbs);
        if (sm.find()) {
            String n = attr(sm.group(), "name");
            if (n != null) return n;
        }
        return "";
    }

    private static boolean hasValue(String cellXml) {
        return cellXml.contains("<v>") || cellXml.contains("<is>") || cellXml.contains("<f");
    }

    private static String colOf(String cellTag) {
        String r = attr(cellTag, "r");
        if (r == null) return "";
        return r.replaceAll("\\d", "");
    }

    private static String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    /** Finds the last filled employee row (column K has a value, rows 3 and below). */
    public static Info inspect(File xlsx) throws IOException {
        Map<String, byte[]> z = readZip(xlsx);
        String path = sheetPath(z);
        String xml = new String(z.get(path), StandardCharsets.UTF_8);
        Info info = analyse(xml);
        info.sheetName = sheetName(z);
        return info;
    }

    private static Info analyse(String xml) {
        Info info = new Info();
        Matcher rm = ROW.matcher(xml);
        while (rm.find()) {
            String row = rm.group();
            Matcher nm = ROW_NUM.matcher(row);
            if (!nm.find()) continue;
            int n = Integer.parseInt(nm.group(1));
            if (n < 3) continue;
            Matcher cm = CELL.matcher(row);
            boolean hasName = false;
            String aCell = "";
            while (cm.find()) {
                String c = cm.group();
                String col = colOf(c);
                if ((col.equals("K") || col.equals("U") || col.equals("AD")) && hasValue(c)) hasName = true;
                if (col.equals("A")) aCell = c;
            }
            if (hasName && n > info.lastRow) {
                info.lastRow = n;
                Matcher v = Pattern.compile("<v>([^<]*)</v>").matcher(aCell);
                int s = info.serial + 1;
                if (v.find() && !aCell.contains("t=\"s\"")) {
                    try { s = (int) Double.parseDouble(v.group(1)); } catch (NumberFormatException ignored) { }
                }
                info.serial = s;
            }
        }
        return info;
    }

    private static int colIndex(String col) {
        int n = 0;
        for (char c : col.toCharArray()) n = n * 26 + (c - 'A' + 1);
        return n;
    }

    /**
     * Copies {@code in} to {@code out} with one new employee row added after the last filled row.
     * {@code values} maps column letters to String / Number / Date-serial values. Column A (SL NO) is filled automatically.
     * @return the row number that was written
     */
    public static int appendRow(File in, File out, Map<String, Object> values) throws IOException {
        Map<String, byte[]> z = readZip(in);
        String path = sheetPath(z);
        String xml = new String(z.get(path), StandardCharsets.UTF_8);
        Info info = analyse(xml);
        if (info.lastRow == 0) throw new IOException("Could not find an example data row in the template (column K, row 3 or below)");
        int newRow = info.lastRow + 1;

        // style source = last filled row
        String srcRow = null;
        Matcher rm = ROW.matcher(xml);
        while (rm.find()) {
            Matcher nm = ROW_NUM.matcher(rm.group());
            if (nm.find() && Integer.parseInt(nm.group(1)) == info.lastRow) { srcRow = rm.group(); break; }
        }
        if (srcRow == null) throw new IOException("Example row missing");
        Matcher open = Pattern.compile("^<row\\b[^>]*?>").matcher(srcRow);
        open.find();
        String openTag = open.group();
        if (openTag.endsWith("/>")) openTag = openTag.substring(0, openTag.length() - 2) + ">";
        openTag = openTag.replaceFirst("\\br=\"\\d+\"", "r=\"" + newRow + "\"");

        Map<String, Object> all = new LinkedHashMap<>(values);
        all.put("A", Integer.valueOf(info.serial + 1));

        StringBuilder row = new StringBuilder(openTag);
        Matcher cm = CELL.matcher(srcRow);
        java.util.Set<String> done = new java.util.HashSet<>();
        while (cm.find()) {
            String c = cm.group();
            String col = colOf(c);
            if (col.isEmpty()) continue;
            String s = attr(c.substring(0, c.indexOf('>') + 1), "s");
            row.append(cell(col, newRow, s, all.get(col)));
            done.add(col);
        }
        // columns with values that the example row had no cell for
        for (Map.Entry<String, Object> e : all.entrySet()) {
            if (!done.contains(e.getKey())) row.append(cell(e.getKey(), newRow, null, e.getValue()));
        }
        row.append("</row>");

        // replace an existing empty row with this number, or insert in order
        String newXml = null;
        Matcher rm2 = ROW.matcher(xml);
        while (rm2.find()) {
            Matcher nm = ROW_NUM.matcher(rm2.group());
            if (!nm.find()) continue;
            int n = Integer.parseInt(nm.group(1));
            if (n == newRow) {
                newXml = xml.substring(0, rm2.start()) + row + xml.substring(rm2.end());
                break;
            }
            if (n > newRow) {
                newXml = xml.substring(0, rm2.start()) + row + xml.substring(rm2.start());
                break;
            }
        }
        if (newXml == null) {
            int i = xml.indexOf("</sheetData>");
            if (i < 0) throw new IOException("Sheet has no data section");
            newXml = xml.substring(0, i) + row + xml.substring(i);
        }
        // widen the used-range marker
        Matcher dm = Pattern.compile("<dimension ref=\"([A-Z]+)(\\d+):([A-Z]+)(\\d+)\"/>").matcher(newXml);
        if (dm.find()) {
            int oldLast = Integer.parseInt(dm.group(4));
            if (newRow > oldLast) {
                newXml = newXml.substring(0, dm.start()) + "<dimension ref=\"" + dm.group(1) + dm.group(2) + ":" + dm.group(3) + newRow + "\"/>" + newXml.substring(dm.end());
            }
        }
        z.put(path, newXml.getBytes(StandardCharsets.UTF_8));

        File tmp = new File(out.getPath() + ".tmp");
        try (ZipOutputStream zo = new ZipOutputStream(new FileOutputStream(tmp))) {
            for (Map.Entry<String, byte[]> e : z.entrySet()) {
                zo.putNextEntry(new ZipEntry(e.getKey()));
                zo.write(e.getValue());
                zo.closeEntry();
            }
        }
        if (out.exists() && !out.delete()) throw new IOException("Cannot replace output file");
        if (!tmp.renameTo(out)) throw new IOException("Cannot write output file");
        return newRow;
    }

    private static String cell(String col, int row, String style, Object v) {
        String ref = col + row;
        String s = style == null ? "" : " s=\"" + style + "\"";
        if (v == null || (v instanceof String && ((String) v).isEmpty())) {
            return "<c r=\"" + ref + "\"" + s + "/>";
        }
        if (v instanceof Number) {
            return "<c r=\"" + ref + "\"" + s + "><v>" + v + "</v></c>";
        }
        return "<c r=\"" + ref + "\"" + s + " t=\"inlineStr\"><is><t xml:space=\"preserve\">" + esc(v.toString()) + "</t></is></c>";
    }
}

package com.hrtools.uanscan

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    App(applicationContext)
                }
            }
        }
    }
}

private class Outcome(val ok: Boolean, val text: String)

private fun displayName(ctx: Context, uri: Uri): String {
    ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
        val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (i >= 0 && c.moveToFirst()) return c.getString(i) ?: "template.xlsx"
    }
    return "template.xlsx"
}

private fun defaultsToMap(d: Defaults): Map<String, String> = mapOf(
    "client" to d.client,
    "subContractor" to d.subContractor,
    "doj" to d.doj,
    "esicWages" to d.esicWages,
    "epfWages" to d.epfWages,
    "remitLoc" to d.remitLoc,
    "dispensary" to d.dispensary,
    "marital" to d.marital
)

private fun mapToDefaults(m: Map<String, String>): Defaults {
    val d = Defaults()
    d.client = (m["client"] ?: "").trim()
    d.subContractor = (m["subContractor"] ?: "").trim()
    d.doj = (m["doj"] ?: "").trim()
    d.esicWages = (m["esicWages"] ?: "").trim()
    d.epfWages = (m["epfWages"] ?: "").trim()
    d.remitLoc = (m["remitLoc"] ?: "").trim()
    d.dispensary = (m["dispensary"] ?: "").trim()
    d.marital = (m["marital"] ?: "").trim()
    return d
}

@Composable
fun App(ctx: Context) {
    val store = remember { Store(ctx) }
    val scope = rememberCoroutineScope()
    var defaults by remember { mutableStateOf(store.loadDefaults()) }
    var templateName by remember { mutableStateOf(store.templateName) }
    var rows by remember { mutableIntStateOf(store.rowsAdded) }
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var review by remember { mutableStateOf<Person?>(null) }
    var reviewKey by remember { mutableIntStateOf(0) }
    var showDefaults by remember { mutableStateOf(false) }

    val pickTemplate = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch {
                busy = true
                message = "Opening template..."
                val res = withContext(Dispatchers.IO) {
                    try {
                        val tmp = java.io.File(ctx.filesDir, "incoming.xlsx")
                        ctx.contentResolver.openInputStream(uri)!!.use { ins ->
                            tmp.outputStream().use { ins.copyTo(it) }
                        }
                        val info = XlsxWriter.inspect(tmp)
                        tmp.copyTo(store.working, overwrite = true)
                        tmp.delete()
                        store.templateName = displayName(ctx, uri)
                        store.rowsAdded = 0
                        Outcome(true, "Template ready. Last filled row: ${info.lastRow}. New people go below it.")
                    } catch (e: Exception) {
                        Outcome(false, "Could not use this file: ${e.message ?: "unreadable"}")
                    }
                }
                if (res.ok) {
                    templateName = store.templateName
                    rows = 0
                }
                message = res.text
                busy = false
            }
        }
    }

    val pickScans = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) {
            scope.launch {
                busy = true
                message = "Reading ${uris.size} file(s) on the phone..."
                val person = withContext(Dispatchers.Default) {
                    val texts = mutableListOf<String>()
                    for (u in uris) texts.addAll(OcrEngine.read(ctx, u))
                    DocParser.parseAll(texts)
                }
                review = person
                reviewKey += 1
                message = ""
                busy = false
            }
        }
    }

    val export = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    ) { uri ->
        if (uri != null) {
            scope.launch {
                val res = withContext(Dispatchers.IO) {
                    try {
                        ctx.contentResolver.openOutputStream(uri)!!.use { os ->
                            store.working.inputStream().use { it.copyTo(os) }
                        }
                        Outcome(true, "Excel saved. Open it from the place you chose.")
                    } catch (e: Exception) {
                        Outcome(false, "Could not save: ${e.message ?: "error"}")
                    }
                }
                message = res.text
            }
        }
    }

    val dmap = remember { mutableStateMapOf<String, String>().apply { putAll(defaultsToMap(defaults)) } }

    val current = review
    if (current != null) {
        ReviewScreen(
            key = reviewKey,
            person = current,
            onSave = { p ->
                scope.launch {
                    busy = true
                    val res = withContext(Dispatchers.IO) {
                        try {
                            val row = XlsxWriter.appendRow(store.working, store.working, RowBuilder.build(p, defaults))
                            store.rowsAdded = store.rowsAdded + 1
                            Outcome(true, "Added to Excel row $row.")
                        } catch (e: Exception) {
                            Outcome(false, "Could not save the row: ${e.message ?: "error"}")
                        }
                    }
                    message = res.text
                    if (res.ok) {
                        rows = store.rowsAdded
                        review = null
                    }
                    busy = false
                }
            },
            onCancel = { review = null },
            message = message,
            busy = busy
        )
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("UAN / ESI document scanner", style = MaterialTheme.typography.headlineSmall)
        Text("Works fully offline. Photos and PDFs are read on this phone.")
        if (busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("1. Excel template", style = MaterialTheme.typography.titleMedium)
                Text(if (templateName.isEmpty()) "No template chosen yet." else "$templateName  -  $rows row(s) added by this app")
                Button(onClick = { pickTemplate.launch(arrayOf("*/*")) }) {
                    Text(if (templateName.isEmpty()) "Choose template (.xlsx)" else "Choose a different template")
                }
            }
        }

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("2. Batch details (same for everyone)", style = MaterialTheme.typography.titleMedium)
                if (!showDefaults) {
                    Text("Client: ${defaults.client}\nSub-contractor: ${defaults.subContractor}\nJoining: ${defaults.doj}   ESIC wages: ${defaults.esicWages}   EPF wages: ${defaults.epfWages}")
                    OutlinedButton(onClick = {
                        dmap.clear()
                        dmap.putAll(defaultsToMap(defaults))
                        showDefaults = true
                    }) { Text("Edit") }
                } else {
                    for (f in Defaults.FIELDS) {
                        val k = f[0]
                        OutlinedTextField(
                            value = dmap[k] ?: "",
                            onValueChange = { dmap[k] = it },
                            label = { Text(f[1]) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = {
                            val d = mapToDefaults(dmap)
                            store.saveDefaults(d)
                            defaults = d
                            showDefaults = false
                        }) { Text("Save") }
                        OutlinedButton(onClick = { showDefaults = false }) { Text("Cancel") }
                    }
                }
            }
        }

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("3. Add a person", style = MaterialTheme.typography.titleMedium)
                Text("Pick all photos / PDFs of ONE person together (Aadhaar, PAN, licence, bank details). You can correct everything before it is saved.")
                Button(
                    enabled = templateName.isNotEmpty() && !busy,
                    onClick = { pickScans.launch(arrayOf("image/*", "application/pdf")) }
                ) { Text("Select documents") }
            }
        }

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("4. Save the finished Excel", style = MaterialTheme.typography.titleMedium)
                Button(
                    enabled = templateName.isNotEmpty() && !busy,
                    onClick = { export.launch("UAN_ESI_filled.xlsx") }
                ) { Text("Save Excel to phone") }
            }
        }

        if (message.isNotEmpty()) Text(message, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
fun ReviewScreen(
    key: Int,
    person: Person,
    onSave: (Person) -> Unit,
    onCancel: () -> Unit,
    message: String,
    busy: Boolean
) {
    val fields = remember(key) { mutableStateMapOf<String, String>().apply { putAll(person.toMap()) } }
    var warnings = 0
    for (f in Person.FIELDS) {
        if (Validate.problem(f[0], fields[f[0]] ?: "") != null) warnings += 1
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text("Check the details", style = MaterialTheme.typography.headlineSmall)
        Text(
            if (warnings == 0) "Everything looks fine. Compare with the documents once, then save."
            else "$warnings field(s) need attention (marked in red). Handwritten text is not read - type it in."
        )
        if (busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())

        for (f in Person.FIELDS) {
            val key2 = f[0]
            val value = fields[key2] ?: ""
            val problem = Validate.problem(key2, value)
            OutlinedTextField(
                value = value,
                onValueChange = { fields[key2] = it },
                label = { Text(f[1]) },
                isError = problem != null,
                supportingText = if (problem != null) {
                    { Text(problem) }
                } else null,
                singleLine = key2 != "address",
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 2.dp)
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            Button(enabled = !busy, onClick = { onSave(Person.fromMap(fields)) }) { Text("Save to Excel") }
            OutlinedButton(enabled = !busy, onClick = onCancel) { Text("Discard") }
        }
        if (message.isNotEmpty()) Text(message, color = MaterialTheme.colorScheme.error)
    }
}

package com.hrtools.uanscan;

/** Values that are the same for every person in a batch (not printed on the documents). */
public class Defaults {
    public String client = "AL UNIT-1 HOSUR";
    public String subContractor = "TVS VEHICLE MOBILITY SOLUTION PRIVATE LIMITED";
    public String doj = "30/09/2026";
    public String esicWages = "19000";
    public String epfWages = "15000";
    public String remitLoc = "HOSUR";
    public String dispensary = "SIPCOT-1 HOSUR";
    public String marital = "UNMARRIED";

    public static final String[][] FIELDS = {
        {"client", "Client"},
        {"subContractor", "Sub-contractor name"},
        {"doj", "Date of joining (dd/mm/yyyy)"},
        {"esicWages", "ESIC gross wages"},
        {"epfWages", "EPF wages"},
        {"remitLoc", "ESI remit location"},
        {"dispensary", "Dispensary"},
        {"marital", "Marital status (UNMARRIED / MARRIED)"},
    };
}

package com.hrtools.uanscan;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns the OCR text of Aadhaar / PAN / driving licence / bank documents into one Person.
 * Pure Java (no Android classes) so it can be tested on a PC.
 */
public final class DocParser {
    private DocParser() {}

    private static final class Doc {
        int rank = 4;
        Person p = new Person();
    }

    private static final String[] JUNK = {
        "GOVERNMENT", "GOVT", "INDIA", "AUTHORITY", "UNIQUE", "IDENTIFICATION", "MALE", "FEMALE",
        "DOB", "ADDRESS", "AADHAAR", "INCOME", "TAX", "DEPARTMENT", "PERMANENT", "ACCOUNT", "NUMBER",
        "CARD", "FATHER", "BIRTH", "DATE", "SIGNATURE", "LICENCE", "DRIVING", "BANK", "BRANCH",
        "VALID", "BLOOD", "GROUP", "CATEGORY", "TRANSPORT", "KERALA", "STATE", "UNION", "PHOTO"
    };

    private static final Map<String, String> BANKS = new HashMap<>();
    static {
        String[] b = {
            "SBIN", "STATE BANK OF INDIA", "IOBA", "INDIAN OVERSEAS BANK", "CNRB", "CANARA BANK",
            "FDRL", "FEDERAL BANK", "IDIB", "INDIAN BANK", "HDFC", "HDFC BANK", "ICIC", "ICICI BANK",
            "UTIB", "AXIS BANK", "KARB", "KARNATAKA BANK", "CIUB", "CITY UNION BANK",
            "UBIN", "UNION BANK OF INDIA", "BARB", "BANK OF BARODA", "PUNB", "PUNJAB NATIONAL BANK",
            "KVBL", "KARUR VYSYA BANK", "TMBL", "TAMILNAD MERCANTILE BANK", "SIBL", "SOUTH INDIAN BANK",
            "IDFB", "IDFC FIRST BANK", "BKID", "BANK OF INDIA", "CBIN", "CENTRAL BANK OF INDIA",
            "UCBA", "UCO BANK", "INDB", "INDUSIND BANK", "KKBK", "KOTAK MAHINDRA BANK", "YESB", "YES BANK",
            "IPOS", "INDIA POST PAYMENTS BANK", "PYTM", "PAYTM PAYMENTS BANK", "DLXB", "DHANLAXMI BANK",
            "CSBK", "CSB BANK", "KLGB", "KERALA GRAMIN BANK", "MAHB", "BANK OF MAHARASHTRA",
            "PSIB", "PUNJAB & SIND BANK", "AIRP", "AIRTEL PAYMENTS BANK", "ESFB", "EQUITAS SMALL FINANCE BANK",
            "AUBL", "AU SMALL FINANCE BANK", "TNSC", "TAMILNADU STATE APEX CO-OP BANK"
        };
        for (int i = 0; i < b.length; i += 2) BANKS.put(b[i], b[i + 1]);
    }

    private static final Pattern DATE = Pattern.compile("(?<!\\d)(\\d{2})\\s*[/\\-.]\\s*(\\d{2})\\s*[/\\-.]\\s*(\\d{4})(?!\\d)");
    private static final Pattern EMAIL = Pattern.compile("[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}");
    private static final Pattern PAN = Pattern.compile("[A-Z]{5}[0-9]{4}[A-Z]");

    // ---------------------------------------------------------------- public API

    public static Person parseAll(List<String> texts) {
        List<Doc> docs = new ArrayList<>();
        for (String t : texts) {
            if (t != null && !t.trim().isEmpty()) docs.add(parseOne(t));
        }
        Collections.sort(docs, new Comparator<Doc>() {
            @Override public int compare(Doc a, Doc b) { return Integer.compare(a.rank, b.rank); }
        });
        Person out = new Person();
        out.relation = "";
        for (Doc d : docs) merge(out, d.p);
        if (out.name.isEmpty() && out.bankHolder.isEmpty()) out.name = consensusName(texts);
        if (out.dob.isEmpty()) out.dob = consensusDob(texts);
        finish(out);
        return out;
    }

    // ---------------------------------------------------------------- one document

    private static Doc parseOne(String text) {
        Doc d = new Doc();
        Person p = d.p;
        String[] raw = text.split("\\r?\\n");
        List<String> lines = new ArrayList<>();
        for (String s : raw) {
            String t = s.trim();
            if (!t.isEmpty()) lines.add(t);
        }
        String up = text.toUpperCase();
        String aad = findAadhaar(text);

        boolean bank = up.contains("IFSC") || up.contains("ACCOUNT NUMBER") || up.contains("A/C NO");
        boolean pan = up.contains("INCOME TAX") || up.contains("PERMANENT ACCOUNT");
        boolean dl = up.contains("DRIVING") || up.contains("LICENCE") || up.contains("LICENSE");
        boolean aadhaarWords = up.contains("AADHAAR") || up.contains("UIDAI") || up.contains("UNIQUE IDENTIFICATION");
        if (aad != null && bank && !aadhaarWords) aad = null;   // a bank sheet's 12-digit mobile can pass the check digit
        boolean aadhaar = aadhaarWords || (aad != null && !pan && !dl);

        if (aadhaar) d.rank = Math.min(d.rank, 0);
        if (pan) d.rank = Math.min(d.rank, 1);
        if (dl) d.rank = Math.min(d.rank, 2);
        if (bank) d.rank = Math.min(d.rank, 3);

        if (aad != null) p.aadhaar = aad;

        String dob = findDob(lines);
        if (!dob.isEmpty()) p.dob = dob;

        if (aadhaar) {
            if (up.matches("(?s).*\\bFEMALE\\b.*")) p.gender = "FEMALE";
            else if (up.matches("(?s).*\\bMALE\\b.*")) p.gender = "MALE";
            p.name = aadhaarName(lines);
            readAadhaarAddress(text, p);
        }
        if (pan) {
            String n = nameAfterLabel(lines, "NAME", "FATHER");
            if (p.name.isEmpty()) p.name = n;
            String f = nameAfterLabel(lines, "FATHER", null);
            if (p.father.isEmpty()) p.father = f;
        }
        if (dl) {
            Matcher m = Pattern.compile("(?im)^\\W*Name\\s*[:\\-]?\\s+(.+)$").matcher(text);
            if (m.find()) {
                String n = cleanName(m.group(1));
                if (p.name.isEmpty() && isNameLine(n)) p.name = n;
            }
            Matcher f = Pattern.compile("(?i)S\\s*/\\s*[WD]\\s*/\\s*[WD]\\s*of\\W*([A-Za-z .]+)").matcher(text);
            if (f.find()) {
                String n = cleanName(f.group(1));
                if (isNameLine(n)) p.father = n;
            }
            Matcher l = Pattern.compile("(?<!\\d)(\\d{2}/\\d{3,5}/\\d{4})(?!\\d)").matcher(text);
            if (l.find()) p.licence = l.group(1);
            else {
                Matcher l2 = Pattern.compile("\\b([A-Z]{2}\\d{2}\\s?\\d{11})\\b").matcher(up);
                if (l2.find()) p.licence = l2.group(1).replace(" ", "");
            }
            if (p.address.isEmpty()) {
                Matcher a = Pattern.compile("(?is)Address\\W{0,3}(.{5,200}?)(?<!\\d)(\\d{6})(?!\\d)").matcher(flat(text));
                if (a.find()) {
                    p.address = a.group(1).replaceAll("\\s+", " ").trim().toUpperCase();
                    p.pin = a.group(2);
                }
            }
        }
        Matcher bg = Pattern.compile("(?i)b[il1]ood\\s*gr\\w*\\W{0,4}(AB|A|B|O)\\s*([+\\-]|pos|neg)").matcher(text);
        if (bg.find()) p.blood = bg.group(1).toUpperCase() + (bg.group(2).startsWith("-") || bg.group(2).toLowerCase().startsWith("n") ? "-VE" : "+VE");
        String pn = findPan(up);
        if (pn != null) p.pan = pn;

        if (bank) {
            readBank(text, lines, p);
        }
        // contact details can be on the bank sheet or typed forms
        if (p.mobile.isEmpty()) p.mobile = findMobile(lines);
        if (p.email.isEmpty()) p.email = findEmail(lines);
        return d;
    }

    private static void merge(Person o, Person n) {
        o.name = pick(o.name, n.name); o.father = pick(o.father, n.father);
        o.relation = pick(o.relation, n.relation);
        o.dob = pick(o.dob, n.dob); o.gender = pick(o.gender, n.gender);
        o.aadhaar = pick(o.aadhaar, n.aadhaar); o.mobile = pick(o.mobile, n.mobile);
        o.pan = pick(o.pan, n.pan); o.licence = pick(o.licence, n.licence);
        o.email = pick(o.email, n.email); o.blood = pick(o.blood, n.blood);
        o.ifsc = pick(o.ifsc, n.ifsc); o.account = pick(o.account, n.account);
        o.bankHolder = pick(o.bankHolder, n.bankHolder); o.bankName = pick(o.bankName, n.bankName);
        o.branch = pick(o.branch, n.branch);
        o.address = pick(o.address, n.address); o.district = pick(o.district, n.district);
        o.state = pick(o.state, n.state); o.pin = pick(o.pin, n.pin);
    }

    private static String pick(String a, String b) { return a.isEmpty() ? b : a; }

    private static void finish(Person p) {
        p.name = p.name.toUpperCase();
        if (p.name.isEmpty()) p.name = p.bankHolder.toUpperCase();
        p.father = p.father.toUpperCase();
        if (p.relation.isEmpty()) p.relation = "FATHER";
        p.bankHolder = p.bankHolder.toUpperCase();
        p.branch = p.branch.toUpperCase();
        p.address = p.address.toUpperCase();
        p.district = p.district.toUpperCase();
        p.state = p.state.toUpperCase();
        p.ifsc = p.ifsc.toUpperCase();
        p.pan = p.pan.toUpperCase();
        if (p.pan.isEmpty()) p.pan = p.licence.toUpperCase();
        p.email = p.email.toLowerCase();
        p.aadhaar = p.aadhaar.replaceAll("\\D", "");
        p.mobile = p.mobile.replaceAll("\\D", "");
        if (p.mobile.length() == 12 && p.mobile.startsWith("91")) p.mobile = p.mobile.substring(2);
        if (p.mobile.equals(p.account)) p.mobile = "";
        if (p.bankName.isEmpty() && p.ifsc.length() >= 4) {
            String b = BANKS.get(p.ifsc.substring(0, 4));
            if (b != null) p.bankName = b;
        }
        if (p.bankHolder.isEmpty()) p.bankHolder = p.name;
    }

    // ---------------------------------------------------------------- field finders

    private static final String[] ADDR_WORDS = {"HOUSE", "ROAD", "STREET", "COLONY", "NAGAR", "TOWN", "VILLAGE", "POST", "OFFICE",
        "DISTRICT", "PIN", "CODE", "SAVINGS", "SCHEME", "STANDARD", "ACTIVE", "SINGLE", "REGISTERED", "MODE", "TYPE", "EMAIL", "MOBILE",
        "CUSTOMER", "EFFECTIVE", "AVAILABLE", "BALANCE", "PHONE", "BANKING", "PARTNER", "YOUR", "PERFECT", "SWIFT", "MICR", "NOMINATION",
        "CURRENCY", "COMMUNICATION", "UPDATED", "OPEN", "JOINT", "HOLDERS", "SERVICES", "UNIT", "PLOT", "SECTOR", "NAVI", "MUMBAI", "LOST", "FOUND", "CASE", "THIS"};

    /** Fallback: a person-name-like phrase that shows up in two or more of the documents. */
    static String consensusName(List<String> texts) {
        Map<String, Integer> count = new HashMap<>();
        Pattern pt = Pattern.compile("\\b[A-Z][A-Za-z]{2,}(?:[ \\t]+[A-Z][A-Za-z]*\\.?){1,2}");
        for (String t : texts) {
            java.util.Set<String> seen = new java.util.HashSet<>();
            Matcher m = pt.matcher(t);
            while (m.find()) {
                String c = m.group().trim().replaceAll("\\s+", " ").toUpperCase();
                if (!isNameLine(c)) continue;
                boolean bad = false;
                for (String w : ADDR_WORDS) if (c.matches("(?s).*\\b" + w + "\\b.*")) bad = true;
                if (!bad) seen.add(c);
            }
            for (String c : seen) count.merge(c, 1, Integer::sum);
        }
        String best = "";
        int bc = 1;
        for (Map.Entry<String, Integer> e : count.entrySet()) {
            if (e.getValue() > bc || (e.getValue() == bc && e.getValue() > 1 && e.getKey().length() < best.length())) {
                best = e.getKey();
                bc = e.getValue();
            }
        }
        return best;
    }

    /** Fallback: a plausible date of birth that shows up in two or more documents. */
    static String consensusDob(List<String> texts) {
        Map<String, Integer> count = new HashMap<>();
        for (String t : texts) {
            java.util.Set<String> seen = new java.util.HashSet<>();
            Matcher m = DATE.matcher(t);
            while (m.find()) {
                int day = Integer.parseInt(m.group(1)), mon = Integer.parseInt(m.group(2)), yr = Integer.parseInt(m.group(3));
                if (day < 1 || day > 31 || mon < 1 || mon > 12 || yr < 1950 || yr > 2010) continue;
                seen.add(m.group(1) + "/" + m.group(2) + "/" + m.group(3));
            }
            for (String c : seen) count.merge(c, 1, Integer::sum);
        }
        String best = "";
        int bc = 1;
        for (Map.Entry<String, Integer> e : count.entrySet()) {
            if (e.getValue() > bc) { best = e.getKey(); bc = e.getValue(); }
        }
        return best;
    }

    static String flat(String t) { return t.replaceAll("[\\r\\n]+", " "); }

    static String findAadhaar(String text) {
        Matcher m = Pattern.compile("(?<!\\d)(\\d{4})\\s?(\\d{4})\\s?(\\d{4})(?!\\d)").matcher(text);
        while (m.find()) {
            String s = m.group(1) + m.group(2) + m.group(3);
            if (Verhoeff.validAadhaar(s)) return s;
        }
        return null;
    }

    static String findPan(String up) {
        Matcher m = Pattern.compile("(?<![A-Z0-9])[A-Z0-9]{10}(?![A-Z0-9])").matcher(up);
        while (m.find()) {
            String t = m.group();
            if (PAN.matcher(t).matches()) return t;
            int letters = 0;
            for (int i = 0; i < 5; i++) if (Character.isLetter(t.charAt(i))) letters++;
            if (letters < 3) continue;
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 10; i++) {
                char c = t.charAt(i);
                boolean wantLetter = i < 5 || i == 9;
                sb.append(wantLetter ? toLetter(c) : toDigit(c));
            }
            if (PAN.matcher(sb).matches()) return sb.toString();
        }
        return null;
    }

    private static char toLetter(char c) {
        switch (c) { case '0': return 'O'; case '1': return 'I'; case '5': return 'S'; case '8': return 'B'; case '2': return 'Z'; default: return c; }
    }

    private static char toDigit(char c) {
        switch (c) { case 'O': return '0'; case 'I': case 'L': return '1'; case 'S': return '5'; case 'B': return '8'; case 'Z': return '2'; default: return c; }
    }

    static String findDob(List<String> lines) {
        for (int i = 0; i < lines.size(); i++) {
            Matcher m = DATE.matcher(lines.get(i));
            while (m.find()) {
                String ctx = lines.get(i) + " " + (i > 0 ? lines.get(i - 1) : "");
                String u = ctx.toUpperCase();
                if (!(u.contains("BIRTH") || u.contains("DOB") || u.contains("D.O.B") || u.contains("जन्म"))) continue;
                int day = Integer.parseInt(m.group(1)), mon = Integer.parseInt(m.group(2)), yr = Integer.parseInt(m.group(3));
                if (day < 1 || day > 31 || mon < 1 || mon > 12 || yr < 1940 || yr > 2015) continue;
                return m.group(1) + "/" + m.group(2) + "/" + m.group(3);
            }
        }
        return "";
    }

    static boolean isNameLine(String s) {
        if (s == null) return false;
        s = s.trim();
        if (!s.matches("[A-Za-z][A-Za-z .']{1,38}[A-Za-z.]")) return false;
        String u = s.toUpperCase();
        for (String j : JUNK) if (u.matches("(?s).*\\b" + j + "\\b.*")) return false;
        return true;
    }

    static String cleanName(String s) {
        s = s.trim().replaceAll("\\s{2,}.*$", "").replaceAll("(?i)\\s+Branch.*$", "");
        return s.replaceAll("[^A-Za-z .']", "").trim();
    }

    /** Name on the Aadhaar front: the clean text line just above the DOB line. */
    static String aadhaarName(List<String> lines) {
        for (int i = 0; i < lines.size(); i++) {
            String u = lines.get(i).toUpperCase();
            if ((u.contains("DOB") || u.contains("D.O.B") || u.contains("DATE OF BIRTH") || u.contains("YEAR OF BIRTH")) && DATE.matcher(lines.get(i)).find()) {
                for (int j = i - 1; j >= Math.max(0, i - 3); j--) {
                    String n = cleanName(lines.get(j));
                    if (isNameLine(n)) return n;
                }
            }
        }
        return "";
    }

    /** Value on the line after a label line (used for PAN: "Name" then the name). */
    static String nameAfterLabel(List<String> lines, String label, String exclude) {
        for (int i = 0; i < lines.size(); i++) {
            String u = lines.get(i).toUpperCase();
            if (!u.contains(label)) continue;
            if (exclude != null && u.contains(exclude)) continue;
            if (u.contains("ACCOUNT") || u.contains("DEPARTMENT")) continue;
            for (int j = i + 1; j <= Math.min(lines.size() - 1, i + 2); j++) {
                String n = cleanName(lines.get(j));
                if (isNameLine(n)) return n;
            }
        }
        return "";
    }

    private static void readAadhaarAddress(String text, Person p) {
        Matcher m = Pattern.compile("(?is)Address\\s*:?\\s*(.{5,300}?)(?<!\\d)(\\d{6})(?!\\d)").matcher(flat(text));
        if (!m.find()) {
            m = Pattern.compile("(?is)\\b([SDWC]\\s*/\\s*O\\b.{5,300}?)(?<!\\d)(\\d{6})(?!\\d)").matcher(flat(text));
            if (!m.find()) return;
        }
        String a = m.group(1).trim();
        String pin = m.group(2);
        Matcher so = Pattern.compile("(?i)^([SDWCH])\\s*/\\s*O\\s*:?\\s*([^,.]+)[,.]\\s*(.*)$").matcher(a);
        if (so.find()) {
            String kind = so.group(1).toUpperCase();
            String who = cleanName(so.group(2));
            if (!who.isEmpty() && !kind.equals("C")) {
                p.father = who;
                p.relation = kind.equals("W") ? "HUSBAND" : "FATHER";
            }
            a = so.group(3);
        }
        List<String> tokens = new ArrayList<>();
        for (String t : a.split(",")) {
            String s = t.replaceAll("\\s+", " ").trim();
            if (!s.isEmpty() && !s.equals(".")) tokens.add(s.toUpperCase());
        }
        if (tokens.size() < 2) return;
        String state = tokens.remove(tokens.size() - 1).replace("TAMIL NADU", "TAMILNADU");
        String district = tokens.isEmpty() ? "" : tokens.get(tokens.size() - 1);
        p.state = state;
        p.district = district;
        p.pin = pin;
        StringBuilder sb = new StringBuilder();
        for (String t : tokens) sb.append(t).append(", ");
        sb.append(state).append(". ").append(pin);
        p.address = sb.toString();
    }

    private static void readBank(String text, List<String> lines, Person p) {
        String up = text.toUpperCase();
        // IFSC: 4 letters, a zero, 6 letters/digits
        Matcher m = Pattern.compile("(?<![A-Z0-9])([A-Z0-9]{4})([0O])([A-Z0-9]{6})(?![A-Z0-9])").matcher(up);
        while (m.find()) {
            String first = m.group(1).replace('0', 'O').replace('1', 'I');
            if (!first.matches("[A-Z]{4}")) continue;
            boolean known = BANKS.containsKey(first);
            String last = m.group(3);
            if (known || up.contains("IFSC")) {
                p.ifsc = first + "0" + last;
                break;
            }
        }
        // Account number
        String ex = excludeDigits(lines);
        for (int i = 0; i < lines.size() && p.account.isEmpty(); i++) {
            String u = lines.get(i).toUpperCase();
            if (u.contains("ACCOUNT NUMBER") || u.contains("ACCOUNT NO") || u.contains("A/C NO")) {
                for (int j = i; j <= Math.min(lines.size() - 1, i + 2); j++) {
                    Matcher d = Pattern.compile("(?<!\\d)(\\d{9,18})(?!\\d)").matcher(lines.get(j));
                    while (d.find()) {
                        if (!ex.contains("|" + d.group(1) + "|")) { p.account = d.group(1); break; }
                    }
                    if (!p.account.isEmpty()) break;
                }
            }
        }
        if (p.account.isEmpty()) {
            String best = "";
            Matcher d = Pattern.compile("(?<!\\d)(\\d{11,18})(?!\\d)").matcher(text);
            while (d.find()) {
                String s = d.group(1);
                if (ex.contains("|" + s + "|")) continue;
                if (s.length() > best.length()) best = s;
            }
            p.account = best;
        }
        // holder name and branch
        Matcher h = Pattern.compile("(?im)^\\W*Name\\s*[:\\-]\\s*(.+)$").matcher(text);
        if (h.find()) {
            String n = cleanName(h.group(1));
            if (isNameLine(n)) p.bankHolder = n;
        }
        if (p.bankHolder.isEmpty()) {
            Matcher h2 = Pattern.compile("(?i)\\bNa\\w{1,2}\\W{1,3}([A-Za-z][A-Za-z .]{2,40}?)\\s+Branch").matcher(text);
            if (h2.find()) {
                String n = cleanName(h2.group(1));
                if (isNameLine(n)) p.bankHolder = n;
            }
        }
        Matcher br = Pattern.compile("(?i)Branch\\s*Name\\s*[:\\-]?\\s*([A-Za-z][A-Za-z .&\\-]{1,40})").matcher(text);
        if (br.find()) p.branch = br.group(1).replaceAll("\\s+", " ").trim();
        // bank name from known text
        for (String b : new String[]{"FEDERAL BANK", "STATE BANK OF INDIA", "CANARA BANK", "INDIAN OVERSEAS BANK", "INDIAN BANK", "HDFC BANK", "ICICI BANK", "AXIS BANK", "UNION BANK OF INDIA", "BANK OF BARODA", "KARNATAKA BANK", "CITY UNION BANK"}) {
            if (up.contains(b)) { p.bankName = b; break; }
        }
    }

    /** Digit strings that are NOT the account number: Aadhaar, mobile, customer id, MICR. */
    private static String excludeDigits(List<String> lines) {
        StringBuilder sb = new StringBuilder("|");
        for (int i = 0; i < lines.size(); i++) {
            String u = lines.get(i).toUpperCase();
            if (u.contains("CUSTOMER") || u.contains("MICR") || u.contains("MOBILE") || u.contains("SOL ID") || u.contains("REGD")) {
                Matcher d = Pattern.compile("(?<!\\d)\\d{6,18}(?!\\d)").matcher(lines.get(i));
                while (d.find()) sb.append(d.group()).append("|");
            }
        }
        return sb.toString();
    }

    static String findMobile(List<String> lines) {
        Pattern pt = Pattern.compile("(?<!\\d)(?:\\+?91[\\s\\-]?)?([6-9]\\d{9})(?!\\d)");
        for (int i = 0; i < lines.size(); i++) {
            String u = lines.get(i).toUpperCase();
            if (u.contains("MOBILE") || u.contains("MOB.") || u.contains("PHONE")) {
                Matcher m = pt.matcher(lines.get(i));
                if (m.find()) return m.group(1);
            }
        }
        return "";
    }

    static String findEmail(List<String> lines) {
        String fallback = "";
        for (String l : lines) {
            Matcher m = EMAIL.matcher(l);
            while (m.find()) {
                String e = m.group().toLowerCase();
                if (e.contains("federalbank") || e.contains("uidai") || e.endsWith(".gov.in") || e.startsWith("contact@") || e.startsWith("help@")) continue;
                if (l.toUpperCase().contains("EMAIL")) return e;
                if (fallback.isEmpty()) fallback = e;
            }
        }
        return fallback;
    }
}

package com.hrtools.uanscan;

/** Check-digit test used by Aadhaar numbers. Catches most OCR misreads. */
public final class Verhoeff {
    private Verhoeff() {}

    private static final int[][] D = {
        {0,1,2,3,4,5,6,7,8,9},{1,2,3,4,0,6,7,8,9,5},{2,3,4,0,1,7,8,9,5,6},
        {3,4,0,1,2,8,9,5,6,7},{4,0,1,2,3,9,5,6,7,8},{5,9,8,7,6,0,4,3,2,1},
        {6,5,9,8,7,1,0,4,3,2},{7,6,5,9,8,2,1,0,4,3},{8,7,6,5,9,3,2,1,0,4},
        {9,8,7,6,5,4,3,2,1,0}};
    private static final int[][] P = {
        {0,1,2,3,4,5,6,7,8,9},{1,5,7,6,2,8,3,0,9,4},{5,8,0,3,7,9,6,1,4,2},
        {8,9,1,6,0,4,3,5,2,7},{9,4,5,3,1,2,6,8,7,0},{4,2,8,6,5,7,3,9,0,1},
        {2,7,9,3,8,0,6,4,1,5},{7,0,4,6,9,1,3,2,5,8}};

    public static boolean valid(String num) {
        if (num == null || !num.matches("\\d+")) return false;
        int c = 0;
        int n = num.length();
        for (int i = 0; i < n; i++) {
            int digit = num.charAt(n - 1 - i) - '0';
            c = D[c][P[i % 8][digit]];
        }
        return c == 0;
    }

    public static boolean validAadhaar(String s) {
        return s != null && s.matches("[2-9]\\d{11}") && valid(s);
    }
}

package com.hrtools.uanscan;

import java.util.LinkedHashMap;
import java.util.Map;

/** One employee's data, as read from the documents and corrected on the review screen. */
public class Person {
    public String name = "", father = "", relation = "FATHER", dob = "", gender = "";
    public String aadhaar = "", mobile = "", pan = "", licence = "", email = "", blood = "";
    public String qualification = "", fatherDob = "";
    public String ifsc = "", account = "", bankHolder = "", bankName = "", branch = "";
    public String address = "", district = "", state = "", pin = "";

    /** Keys in the order they are shown on the review screen. */
    public static final String[][] FIELDS = {
        {"name", "Name (as per Aadhaar)"},
        {"father", "Father / Husband name"},
        {"relation", "Relationship (FATHER / HUSBAND ...)"},
        {"fatherDob", "Father / nominee date of birth (dd/mm/yyyy)"},
        {"dob", "Date of birth (dd/mm/yyyy)"},
        {"gender", "Gender (MALE / FEMALE)"},
        {"aadhaar", "Aadhaar number"},
        {"mobile", "Mobile number"},
        {"pan", "PAN / Licence / Passport number"},
        {"email", "Email"},
        {"blood", "Blood group"},
        {"qualification", "Qualification"},
        {"ifsc", "IFSC code"},
        {"account", "Bank account number"},
        {"bankHolder", "Name as per bank records"},
        {"bankName", "Bank name"},
        {"branch", "Branch"},
        {"address", "Address"},
        {"district", "District"},
        {"state", "State"},
        {"pin", "PIN code"},
    };

    public Map<String, String> toMap() {
        LinkedHashMap<String, String> m = new LinkedHashMap<>();
        m.put("name", name); m.put("father", father); m.put("relation", relation);
        m.put("fatherDob", fatherDob); m.put("dob", dob); m.put("gender", gender);
        m.put("aadhaar", aadhaar); m.put("mobile", mobile);
        m.put("pan", pan.isEmpty() ? licence : pan);
        m.put("email", email); m.put("blood", blood); m.put("qualification", qualification);
        m.put("ifsc", ifsc); m.put("account", account); m.put("bankHolder", bankHolder);
        m.put("bankName", bankName); m.put("branch", branch); m.put("address", address);
        m.put("district", district); m.put("state", state); m.put("pin", pin);
        return m;
    }

    private static String g(Map<String, String> m, String k) {
        String v = m.get(k);
        return v == null ? "" : v.trim();
    }

    public static Person fromMap(Map<String, String> m) {
        Person p = new Person();
        p.name = g(m, "name"); p.father = g(m, "father"); p.relation = g(m, "relation");
        p.fatherDob = g(m, "fatherDob"); p.dob = g(m, "dob"); p.gender = g(m, "gender");
        p.aadhaar = g(m, "aadhaar"); p.mobile = g(m, "mobile"); p.pan = g(m, "pan");
        p.email = g(m, "email"); p.blood = g(m, "blood"); p.qualification = g(m, "qualification");
        p.ifsc = g(m, "ifsc"); p.account = g(m, "account"); p.bankHolder = g(m, "bankHolder");
        p.bankName = g(m, "bankName"); p.branch = g(m, "branch"); p.address = g(m, "address");
        p.district = g(m, "district"); p.state = g(m, "state"); p.pin = g(m, "pin");
        return p;
    }
}

package com.hrtools.uanscan

import android.content.Context
import java.io.File

/** Small on-phone storage: batch defaults, the working copy of the template, and a row counter. */
class Store(private val ctx: Context) {
    private val prefs = ctx.getSharedPreferences("uanscan", Context.MODE_PRIVATE)

    val working: File get() = File(ctx.filesDir, "working.xlsx")

    var templateName: String
        get() = prefs.getString("templateName", "") ?: ""
        set(v) { prefs.edit().putString("templateName", v).apply() }

    var rowsAdded: Int
        get() = prefs.getInt("rowsAdded", 0)
        set(v) { prefs.edit().putInt("rowsAdded", v).apply() }

    fun loadDefaults(): Defaults {
        val d = Defaults()
        d.client = prefs.getString("client", d.client) ?: d.client
        d.subContractor = prefs.getString("subContractor", d.subContractor) ?: d.subContractor
        d.doj = prefs.getString("doj", d.doj) ?: d.doj
        d.esicWages = prefs.getString("esicWages", d.esicWages) ?: d.esicWages
        d.epfWages = prefs.getString("epfWages", d.epfWages) ?: d.epfWages
        d.remitLoc = prefs.getString("remitLoc", d.remitLoc) ?: d.remitLoc
        d.dispensary = prefs.getString("dispensary", d.dispensary) ?: d.dispensary
        d.marital = prefs.getString("marital", d.marital) ?: d.marital
        return d
    }

    fun saveDefaults(d: Defaults) {
        prefs.edit()
            .putString("client", d.client)
            .putString("subContractor", d.subContractor)
            .putString("doj", d.doj)
            .putString("esicWages", d.esicWages)
            .putString("epfWages", d.epfWages)
            .putString("remitLoc", d.remitLoc)
            .putString("dispensary", d.dispensary)
            .putString("marital", d.marital)
            .apply()
    }
}

package com.hrtools.uanscan;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;

/** Gives a short warning for a field that looks wrong, or null when it looks fine. */
public final class Validate {
    private Validate() {}

    public static LocalDate parseDate(String s) {
        if (s == null) return null;
        String[] p = s.trim().split("[/\\-.]");
        if (p.length != 3) return null;
        try {
            return LocalDate.of(Integer.parseInt(p[2].trim()), Integer.parseInt(p[1].trim()), Integer.parseInt(p[0].trim()));
        } catch (NumberFormatException | DateTimeParseException e) {
            return null;
        }
    }

    public static String problem(String key, String value) {
        String v = value == null ? "" : value.trim();
        switch (key) {
            case "name": case "dob": case "aadhaar": case "mobile": case "ifsc": case "account":
                if (v.isEmpty()) return "Required - please fill in";
                break;
            default:
                if (v.isEmpty()) return null;
        }
        switch (key) {
            case "aadhaar":
                if (!v.matches("\\d{12}")) return "Must be 12 digits";
                if (!Verhoeff.validAadhaar(v)) return "Check digit fails - a digit was probably misread";
                return null;
            case "mobile":
                return v.matches("[6-9]\\d{9}") ? null : "Must be 10 digits";
            case "dob": case "fatherDob":
                return parseDate(v) == null ? "Use dd/mm/yyyy" : null;
            case "ifsc":
                return v.matches("[A-Z]{4}0[A-Z0-9]{6}") ? null : "IFSC looks wrong";
            case "pan":
                return (v.matches("[A-Z]{5}\\d{4}[A-Z]") || v.length() >= 6) ? null : "Looks wrong";
            case "pin":
                return v.matches("\\d{6}") ? null : "Must be 6 digits";
            case "email":
                return v.matches("[^@\\s]+@[^@\\s]+\\.[A-Za-z]{2,}") ? null : "Email looks wrong";
            case "account":
                return v.matches("\\d{8,18}") ? null : "Account number looks wrong";
            default:
                return null;
        }
    }
}

package com.hrtools.uanscan

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/** Reads text from photos and PDFs on the phone itself (no internet). */
object OcrEngine {
    private val recognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

    private suspend fun recognize(image: InputImage): String = suspendCoroutine { cont ->
        recognizer.process(image)
            .addOnSuccessListener { cont.resume(it.text) }
            .addOnFailureListener { cont.resume("") }
    }

    /** Returns one text per photo, or one text per PDF page. */
    suspend fun read(ctx: Context, uri: Uri): List<String> {
        val mime = ctx.contentResolver.getType(uri) ?: ""
        val isPdf = mime.contains("pdf") || uri.toString().lowercase().endsWith(".pdf")
        return if (isPdf) readPdf(ctx, uri) else readImage(ctx, uri)
    }

    private suspend fun readImage(ctx: Context, uri: Uri): List<String> {
        return try {
            // fromFilePath also applies the photo's rotation (WhatsApp photos are often sideways)
            listOf(recognize(InputImage.fromFilePath(ctx, uri)))
        } catch (e: Exception) {
            emptyList()
        }
    }

    private suspend fun readPdf(ctx: Context, uri: Uri): List<String> {
        val out = mutableListOf<String>()
        try {
            val pfd = ctx.contentResolver.openFileDescriptor(uri, "r") ?: return out
            val renderer = PdfRenderer(pfd)
            try {
                val pages = minOf(renderer.pageCount, 6)
                for (i in 0 until pages) {
                    val page = renderer.openPage(i)
                    try {
                        val scale = 2.5f
                        val w = (page.width * scale).toInt().coerceAtLeast(1)
                        val h = (page.height * scale).toInt().coerceAtLeast(1)
                        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                        bmp.eraseColor(Color.WHITE)
                        page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        out.add(recognize(InputImage.fromBitmap(bmp, 0)))
                        bmp.recycle()
                    } finally {
                        page.close()
                    }
                }
            } finally {
                renderer.close()
                pfd.close()
            }
        } catch (e: Exception) {
            // unreadable PDF: return what we have
        }
        return out
    }
}

package com.hrtools.uanscan;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;

/** Maps a Person + batch defaults to template columns (A..CG). Values are String, Long or Integer. */
public final class RowBuilder {
    private RowBuilder() {}

    private static Object date(String s) {
        LocalDate d = Validate.parseDate(s);
        if (d == null) return s == null ? "" : s;
        return Long.valueOf(ChronoUnit.DAYS.between(LocalDate.of(1899, 12, 30), d));
    }

    private static Object num(String s) {
        if (s == null) return "";
        String t = s.trim();
        if (t.matches("\\d{1,9}")) return Integer.valueOf(Integer.parseInt(t));
        if (t.matches("\\d{10,15}")) return Long.valueOf(Long.parseLong(t));
        return t;
    }

    public static Map<String, Object> build(Person p, Defaults d) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("K", p.name);
        r.put("L", p.father);
        r.put("M", date(p.dob));
        r.put("N", date(d.doj));
        r.put("Q", p.gender);
        r.put("R", d.marital);
        r.put("S", d.client);
        r.put("T", d.subContractor);
        r.put("U", p.aadhaar);
        r.put("V", num(p.mobile));
        r.put("W", p.pan);
        r.put("X", p.email);
        r.put("Y", p.blood);
        r.put("Z", p.qualification);
        r.put("AA", num(d.esicWages));
        r.put("AB", num(d.epfWages));
        r.put("AC", p.ifsc);
        r.put("AD", p.account);
        r.put("AE", p.bankHolder);
        r.put("AF", p.bankName);
        r.put("AG", p.branch);
        r.put("AH", d.remitLoc);
        r.put("AI", d.dispensary);
        // present address
        r.put("AJ", p.address); r.put("AK", p.district); r.put("AL", p.state); r.put("AM", num(p.pin));
        // permanent address (same as present; edit in Excel if different)
        r.put("AN", p.address); r.put("AO", p.district); r.put("AP", p.state); r.put("AQ", num(p.pin));
        // nominee = father / husband
        r.put("AR", p.father); r.put("AS", p.relation);
        r.put("AT", p.address); r.put("AU", p.district); r.put("AV", p.state); r.put("AW", num(p.pin));
        // family member 1 = same person
        r.put("AX", p.father); r.put("AY", date(p.fatherDob)); r.put("AZ", p.relation);
        r.put("BA", p.father.isEmpty() ? "" : "YES");
        r.put("BB", p.district); r.put("BC", p.state);
        return r;
    }
}

<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="false"
        android:label="UAN ESI Scan"
        android:theme="@android:style/Theme.Material.Light.NoActionBar">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
