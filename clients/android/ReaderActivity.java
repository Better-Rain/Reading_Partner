package privatebooks.readingpartner;

import android.app.*;
import android.os.*;
import android.content.*;
import android.net.Uri;
import android.webkit.*;
import android.widget.*;
import android.view.View;
import android.security.keystore.*;
import android.util.Base64;
import java.security.KeyStore;
import java.net.URL;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

public final class ReaderActivity extends Activity {
    private final String[] hosts = LibraryConnection.HOSTS;
    private final ExecutorService pool = Executors.newFixedThreadPool(hosts.length);
    private final AtomicInteger generation = new AtomicInteger();
    private WebView reader;
    private String origin;
    private ValueCallback<Uri[]> fileResult;
    private String deviceToken;
    private String pendingExport;

    public void onCreate(Bundle state) {
        super.onCreate(state);
        try { deviceToken = loadToken(); } catch (Exception ignored) { }
        if (deviceToken == null) pair(); else connect();
    }
    private SecretKey secretKey() throws Exception {
        KeyStore keys=KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        if (!keys.containsAlias("reading-device")) {
            KeyGenerator generator=KeyGenerator.getInstance("AES","AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("reading-device",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes("GCM").setEncryptionPaddings("NoPadding").build()); generator.generateKey();
        }
        return (SecretKey)keys.getKey("reading-device",null);
    }
    private String loadToken() throws Exception {
        SharedPreferences p=getSharedPreferences("pair",MODE_PRIVATE);String value=p.getString("token",null);if(value==null)return null;
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE,secretKey(),new GCMParameterSpec(128,Base64.decode(p.getString("iv",""),Base64.NO_WRAP)));
        return new String(c.doFinal(Base64.decode(value,Base64.NO_WRAP)),"UTF-8");
    }
    private void pair() {
        LinearLayout layout=layout();EditText input=new EditText(this); input.setSingleLine(); input.setInputType(129);input.setHint("输入手机配对码");layout.addView(input);
        Button button=new Button(this);button.setText("连接私人书库");layout.addView(button);
        button.setOnClickListener(v->{String t=input.getText().toString().trim();if(!t.matches("[a-f0-9]{64}")){input.setError("配对码格式不正确");return;}
            try {Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,secretKey());getSharedPreferences("pair",MODE_PRIVATE).edit().putString("token",Base64.encodeToString(c.doFinal(t.getBytes("UTF-8")),Base64.NO_WRAP)).putString("iv",Base64.encodeToString(c.getIV(),Base64.NO_WRAP)).apply();deviceToken=t;connect();} catch(Exception e){input.setError("无法保存配对码");}});
    }
    private LinearLayout layout(){LinearLayout l=new LinearLayout(this);l.setOrientation(1);l.setGravity(17);l.setPadding(32,24,32,24);setContentView(l);return l;}
    private void connect(){
        int id=generation.incrementAndGet();LinearLayout l=layout();TextView text=new TextView(this);text.setText("正在连接 Mac 书库…");l.addView(text);
        AtomicBoolean found=new AtomicBoolean();AtomicInteger remaining=new AtomicInteger(hosts.length);
        for(String h:hosts)pool.execute(()->{String address="https://"+h+":"+LibraryConnection.PORT;HttpsURLConnection conn=null;try{
            conn=(HttpsURLConnection)new URL(address+"/health").openConnection(java.net.Proxy.NO_PROXY);conn.setConnectTimeout(3500);conn.setReadTimeout(3500);
            if(conn.getResponseCode()==200 && found.compareAndSet(false,true))runOnUiThread(()->{if(id==generation.get())open(address);});
        }catch(Exception ignored){}finally{if(conn!=null)conn.disconnect();if(remaining.decrementAndGet()==0&&!found.get())runOnUiThread(()->{if(id!=generation.get())return;text.setText("无法连接 Mac。请接入私人网络后重试。");Button retry=new Button(this);retry.setText("重新连接");l.addView(retry);retry.setOnClickListener(v->connect());});}});
    }
    private void open(String address){
        origin=address;reader=new WebView(this);setContentView(reader);WebSettings s=reader.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        reader.addJavascriptInterface(new Object() {
            @JavascriptInterface public void saveMarks(String json) {
                runOnUiThread(() -> {
                    if (pendingExport != null) return;
                    pendingExport = json;
                    Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    save.addCategory(Intent.CATEGORY_OPENABLE);
                    save.setType("application/json");
                    save.putExtra(Intent.EXTRA_TITLE, "reading-marks.json");
                    startActivityForResult(save, 8);
                });
            }
        }, "ReadingExports");
        reader.setWebViewClient(new WebViewClient(){public boolean shouldOverrideUrlLoading(WebView w,WebResourceRequest r){return !r.getUrl().toString().startsWith(origin+"/");}
            public void onReceivedError(WebView w,WebResourceRequest r,WebResourceError err){if(r.isForMainFrame())connect();}
            public void onReceivedHttpError(WebView w,WebResourceRequest r,WebResourceResponse response){if(r.isForMainFrame()&&response.getStatusCode()==401)pair();}});
        reader.setWebChromeClient(new WebChromeClient(){public boolean onShowFileChooser(WebView w,ValueCallback<Uri[]> cb,FileChooserParams params){if(fileResult!=null)fileResult.onReceiveValue(null);fileResult=cb;Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");startActivityForResult(i,7);return true;}});
        CookieManager.getInstance().setCookie(address,"__Host-rp="+deviceToken+"; Path=/; Secure; HttpOnly; SameSite=Strict",success->reader.loadUrl(address+"/"));
    }
    protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==8) {
            String json=pendingExport; pendingExport=null;
            if(result==RESULT_OK && data!=null && data.getData()!=null && json!=null) {
                try(java.io.OutputStream stream=getContentResolver().openOutputStream(data.getData())) {
                    stream.write(json.getBytes("UTF-8"));
                } catch(Exception e) {Toast.makeText(this,"导出失败",Toast.LENGTH_LONG).show();}
            }
        }
        if(request==7 && fileResult!=null){fileResult.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));fileResult=null;}}
    public void onBackPressed(){if(reader!=null && reader.canGoBack())reader.goBack();else super.onBackPressed();}
    public void onDestroy(){generation.incrementAndGet();pool.shutdownNow();if(reader!=null)reader.destroy();super.onDestroy();}
}
