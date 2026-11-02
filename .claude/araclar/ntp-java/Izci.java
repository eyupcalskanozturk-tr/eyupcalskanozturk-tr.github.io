import com.sun.jdi.AbsentInformationException;
import com.sun.jdi.ArrayReference;
import com.sun.jdi.BooleanValue;
import com.sun.jdi.Bootstrap;
import com.sun.jdi.ByteValue;
import com.sun.jdi.CharValue;
import com.sun.jdi.ClassType;
import com.sun.jdi.DoubleValue;
import com.sun.jdi.Field;
import com.sun.jdi.FloatValue;
import com.sun.jdi.IntegerValue;
import com.sun.jdi.LocalVariable;
import com.sun.jdi.Location;
import com.sun.jdi.LongValue;
import com.sun.jdi.Method;
import com.sun.jdi.ObjectReference;
import com.sun.jdi.ReferenceType;
import com.sun.jdi.ShortValue;
import com.sun.jdi.StackFrame;
import com.sun.jdi.StringReference;
import com.sun.jdi.ThreadReference;
import com.sun.jdi.Value;
import com.sun.jdi.VirtualMachine;
import com.sun.jdi.connect.Connector;
import com.sun.jdi.connect.LaunchingConnector;
import com.sun.jdi.event.BreakpointEvent;
import com.sun.jdi.event.ClassPrepareEvent;
import com.sun.jdi.event.Event;
import com.sun.jdi.event.EventSet;
import com.sun.jdi.event.ExceptionEvent;
import com.sun.jdi.event.MethodExitEvent;
import com.sun.jdi.event.StepEvent;
import com.sun.jdi.event.VMDeathEvent;
import com.sun.jdi.event.VMDisconnectEvent;
import com.sun.jdi.request.BreakpointRequest;
import com.sun.jdi.request.ClassPrepareRequest;
import com.sun.jdi.request.EventRequest;
import com.sun.jdi.request.EventRequestManager;
import com.sun.jdi.request.ExceptionRequest;
import com.sun.jdi.request.MethodExitRequest;
import com.sun.jdi.request.StepRequest;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * ntp-vize-iz.py'nin adım adım izleyicisi (JDI). Programı Kosucu üzerinden hata ayıklama kipinde
 * başlatır ve kullanıcı sınıflarındaki her satırda durup çağrı yığınını, yerel değişkenleri,
 * nesneleri ve dizileri kaydeder.
 *
 * java Izci SINIF_YOLU GIRDI_DOSYASI EN_COK_ADIM CIKTI_ONEKI SINIF1,SINIF2 ANA [argümanlar...]
 *
 * Yazdıkları: ONEK.out (standart çıktı), ONEK.err (hata çıktısı), ONEK.json (adımlar).
 */
public final class Izci {
    private static final String[] DISLA = {"java.*", "javax.*", "sun.*", "jdk.*", "com.sun.*",
        "Kosucu", "Kosucu$*", "SatirSatir"};
    private static final int DIZI_SINIRI = 30;
    private static final int NESNE_SINIRI = 60;

    private final Set<String> kullanici;
    private final int enCok;
    private VirtualMachine vm;
    private EventRequestManager erm;
    private ClassType kosucu;
    private Field yazilan;
    private final StringBuilder adimlar = new StringBuilder();
    private int adimSayisi;
    private boolean kesildi;
    private final List<String> bekleyen = new ArrayList<>();
    private final Map<Long, Integer> kimlik = new HashMap<>();
    private final Map<Integer, String> sonDurum = new HashMap<>();
    private boolean istisnaYolda;

    private Izci(Set<String> kullanici, int enCok) {
        this.kullanici = kullanici;
        this.enCok = enCok;
    }

    public static void main(String[] a) throws Exception {
        String sinifYolu = a[0];
        byte[] girdi = Files.readAllBytes(Path.of(a[1]));
        int enCok = Integer.parseInt(a[2]);
        String onek = a[3];
        Set<String> kullanici = new TreeSet<>(Arrays.asList(a[4].split(",")));
        String ana = a[5];
        String[] argumanlar = Arrays.copyOfRange(a, 6, a.length);
        new Izci(kullanici, enCok).calistir(sinifYolu, girdi, onek, ana, argumanlar);
    }

    private void calistir(String sinifYolu, byte[] girdi, String onek, String ana, String[] argumanlar)
            throws Exception {
        LaunchingConnector lc = Bootstrap.virtualMachineManager().defaultConnector();
        Map<String, Connector.Argument> ca = lc.defaultArguments();
        StringBuilder anaSatir = new StringBuilder("Kosucu ").append(ana);
        for (String x : argumanlar) {
            anaSatir.append(' ').append(x);
        }
        ca.get("main").setValue(anaSatir.toString());
        ca.get("options").setValue("-cp " + sinifYolu + " -Duser.language=tr -Duser.country=TR"
                + " -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -Dfile.encoding=UTF-8 -Xshare:auto");
        vm = lc.launch(ca);
        Process p = vm.process();
        ByteArrayOutputStream cikti = new ByteArrayOutputStream();
        ByteArrayOutputStream hata = new ByteArrayOutputStream();
        Thread t1 = pompala(p.getInputStream(), cikti);
        Thread t2 = pompala(p.getErrorStream(), hata);
        try (OutputStream os = p.getOutputStream()) {
            os.write(girdi);
        } catch (IOException e) {
            // program girdiyi okumadan bittiyse boru kapanmış olabilir
        }

        erm = vm.eventRequestManager();
        ClassPrepareRequest cpr = erm.createClassPrepareRequest();
        cpr.addClassFilter(ana);
        cpr.enable();
        if (vm.canGetMethodReturnValues()) {
            for (String k : kullanici) {
                MethodExitRequest mx = erm.createMethodExitRequest();
                mx.addClassFilter(k);
                mx.setSuspendPolicy(EventRequest.SUSPEND_ALL);
                mx.enable();
            }
        }

        boolean bitti = false;
        while (!bitti) {
            EventSet es = vm.eventQueue().remove();
            for (Event e : es) {
                if (e instanceof ClassPrepareEvent cpe) {
                    for (Method m : cpe.referenceType().methodsByName("main")) {
                        if (m.signature().equals("([Ljava/lang/String;)V")) {
                            BreakpointRequest br = erm.createBreakpointRequest(m.location());
                            br.enable();
                        }
                    }
                } else if (e instanceof BreakpointEvent be) {
                    erm.deleteEventRequest(be.request());
                    kosucu = (ClassType) vm.classesByName("Kosucu").get(0);
                    yazilan = kosucu.fieldByName("yazilan");
                    ExceptionRequest er = erm.createExceptionRequest(null, true, true);
                    er.enable();
                    bekleyen.add("Program main metodundan başlar.");
                    kaydet(be.thread());
                    StepRequest sr = erm.createStepRequest(be.thread(), StepRequest.STEP_LINE, StepRequest.STEP_INTO);
                    for (String d : DISLA) {
                        sr.addClassExclusionFilter(d);
                    }
                    sr.enable();
                } else if (e instanceof StepEvent se) {
                    if (kesildi) {
                        continue;
                    }
                    if (kullanici.contains(se.location().declaringType().name())) {
                        istisnaYolda = false;
                        kaydet(se.thread());
                    }
                    if (adimSayisi >= enCok) {
                        kes();
                    }
                } else if (e instanceof MethodExitEvent mx) {
                    if (!kesildi) {
                        donus(mx);
                    }
                } else if (e instanceof ExceptionEvent ex) {
                    if (!kesildi) {
                        istisna(ex);
                    }
                } else if (e instanceof VMDeathEvent || e instanceof VMDisconnectEvent) {
                    bitti = true;
                }
            }
            if (!bitti) {
                es.resume();
            }
        }
        int cikis = p.waitFor();
        t1.join();
        t2.join();
        Files.write(Path.of(onek + ".out"), cikti.toByteArray());
        Files.write(Path.of(onek + ".err"), hata.toByteArray());
        String json = "{\"cikis\":" + cikis + ",\"kesildi\":" + kesildi + ",\"adimlar\":[" + adimlar + "]}";
        Files.writeString(Path.of(onek + ".json"), json, StandardCharsets.UTF_8);
    }

    private void kes() {
        kesildi = true;
        erm.deleteEventRequests(new ArrayList<>(erm.stepRequests()));
        erm.deleteEventRequests(new ArrayList<>(erm.methodExitRequests()));
        erm.deleteEventRequests(new ArrayList<>(erm.exceptionRequests()));
    }

    private static Thread pompala(InputStream in, ByteArrayOutputStream hedef) {
        Thread t = new Thread(() -> {
            byte[] b = new byte[8192];
            int n;
            try {
                while ((n = in.read(b)) > 0) {
                    synchronized (hedef) {
                        hedef.write(b, 0, n);
                    }
                }
            } catch (IOException e) {
                // süreç kapandı
            }
        });
        t.start();
        return t;
    }

    // ---------------------------------------------------------------- olaylar

    private void donus(MethodExitEvent mx) {
        Method m = mx.method();
        String ad = m.name();
        if (ad.startsWith("lambda$") || ad.equals("<clinit>") || m.isSynthetic() || istisnaYolda) {
            return;
        }
        if (ad.equals("main") && m.signature().equals("([Ljava/lang/String;)V")) {
            return;
        }
        String sinif = kisa(m.declaringType().name());
        if (m.isConstructor()) {
            String ref = "";
            try {
                ObjectReference bu = mx.thread().frame(0).thisObject();
                if (bu != null) {
                    ref = " (#" + no(bu) + ")";
                }
            } catch (Exception e) {
                // çerçeve okunamadı
            }
            bekleyen.add("Kurucu bitti. new, yeni " + sinif + " nesnesinin referansını" + ref + " döndürür.");
        } else if (m.returnTypeName().equals("void")) {
            bekleyen.add(ad + "() bitti, çağrıldığı yere dönülüyor.");
        } else {
            bekleyen.add(ad + "() " + deger(mx.returnValue()) + " döndürdü.");
        }
    }

    private void istisna(ExceptionEvent ex) throws Exception {
        ObjectReference ist = ex.exception();
        String tip = kisa(ist.referenceType().name());
        String mesaj = mesaj(ist);
        String metin = tip + (mesaj == null ? "" : ": " + mesaj);
        Location atilan = ex.location();
        Location yakalanan = ex.catchLocation();
        boolean atilanK = kullanici.contains(atilan.declaringType().name());
        boolean yakalananK = yakalanan != null && kullanici.contains(yakalanan.declaringType().name());

        List<StackFrame> fr = ex.thread().frames();
        int enAltKullanici = -1;
        for (int i = 0; i < fr.size(); i++) {
            if (kullanici.contains(fr.get(i).location().declaringType().name())) {
                enAltKullanici = i;
            }
        }
        if (enAltKullanici < 0) {
            return; // kullanıcı kodu yığında değil: JDK'nın kendi işi
        }
        if (yakalananK) {
            istisnaYolda = true;
            String nerede = atilanK ? "throw" : "Java'nın " + kisa(atilan.declaringType().name()) + " sınıfı";
            bekleyen.add("İstisna: " + metin + " (" + nerede + " fırlattı). Akış, kalan satırları atlayıp "
                    + "uyan catch bloğuna geçiyor.");
            return;
        }
        // Yakalayan çerçeve main'in altındaysa (yansıtma/Kosucu) istisna kullanıcı kodundan kaçıyor demektir.
        // Üstündeyse JDK kendi içinde yakalıyor (örn. Scanner bir istisnayı başkasına çeviriyor): geç.
        int yakalayanCerceve = Integer.MAX_VALUE;
        if (yakalanan != null) {
            for (int i = 0; i < fr.size(); i++) {
                if (fr.get(i).location().method().equals(yakalanan.method())) {
                    yakalayanCerceve = i;
                    break;
                }
            }
        }
        if (yakalayanCerceve <= enAltKullanici) {
            return;
        }
        istisnaYolda = true;
        bekleyen.add("İstisna: " + metin + ". Yakalayan catch yok; program burada durur.");
        kaydet(ex.thread());
    }

    // ---------------------------------------------------------------- kayıt

    private void kaydet(ThreadReference th) throws Exception {
        List<StackFrame> fr = th.frames();
        StringBuilder y = new StringBuilder();
        Deque<ObjectReference> kuyruk = new ArrayDeque<>();
        Location ust = null;
        for (int i = fr.size() - 1; i >= 0; i--) {
            StackFrame f = fr.get(i);
            Location loc = f.location();
            String sinif = loc.declaringType().name();
            if (!kullanici.contains(sinif)) {
                continue;
            }
            ust = loc;
            Method m = loc.method();
            if (y.length() > 0) {
                y.append(',');
            }
            y.append("{\"m\":").append(js(m.isConstructor() ? kisa(sinif) : m.name()))
                    .append(",\"s\":").append(js(kisa(sinif)))
                    .append(",\"l\":").append(loc.lineNumber());
            if (m.isConstructor()) {
                y.append(",\"k\":1");
            }
            y.append(",\"v\":[");
            boolean ilk = true;
            ObjectReference bu = f.thisObject();
            if (bu != null) {
                y.append(uclu("this", deger(bu, kuyruk), kisa(bu.referenceType().name())));
                ilk = false;
            }
            List<LocalVariable> lv;
            try {
                lv = f.visibleVariables();
            } catch (AbsentInformationException e) {
                lv = List.of();
            }
            Map<LocalVariable, Value> vals = lv.isEmpty() ? Map.of() : f.getValues(lv);
            for (LocalVariable v : lv) {
                Value d = vals.get(v);
                if (v.name().equals("args") && m.name().equals("main") && d instanceof ArrayReference ar
                        && ar.length() == 0) {
                    continue;
                }
                if (!ilk) {
                    y.append(',');
                }
                ilk = false;
                y.append(uclu(v.name(), deger(d, kuyruk), kisa(v.typeName())));
            }
            y.append("]}");
        }
        // static alanlar
        StringBuilder st = new StringBuilder();
        for (String k : kullanici) {
            List<ReferenceType> rt = vm.classesByName(k);
            if (rt.isEmpty()) {
                continue;
            }
            for (Field fl : rt.get(0).fields()) {
                if (!fl.isStatic() || fl.isSynthetic()) {
                    continue;
                }
                if (st.length() > 0) {
                    st.append(',');
                }
                st.append(uclu(kisa(k) + "." + fl.name(), deger(rt.get(0).getValue(fl), kuyruk), kisa(fl.typeName())));
            }
        }
        // yığından ulaşılan nesneler: yalnız değişenler yazılır
        StringBuilder h = new StringBuilder();
        Map<Integer, Boolean> gorulen = new LinkedHashMap<>();
        while (!kuyruk.isEmpty() && gorulen.size() < NESNE_SINIRI) {
            ObjectReference o = kuyruk.poll();
            int n = no(o);
            if (gorulen.containsKey(n)) {
                continue;
            }
            gorulen.put(n, true);
            String durum = durum(o, kuyruk);
            if (!durum.equals(sonDurum.get(n))) {
                sonDurum.put(n, durum);
                if (h.length() > 0) {
                    h.append(',');
                }
                h.append('"').append(n).append("\":").append(durum);
            }
        }
        long bayt = ((LongValue) kosucu.getValue(yazilan)).value();
        String yigin = y.toString();
        if (adimlar.length() > 0) {
            adimlar.append(',');
        }
        adimlar.append("{\"f\":").append(js(ust == null ? "" : ust.sourceName()))
                .append(",\"l\":").append(ust == null ? 0 : ust.lineNumber())
                .append(",\"y\":[").append(yigin).append(']');
        if (st.length() > 0) {
            adimlar.append(",\"st\":[").append(st).append(']');
        }
        if (h.length() > 0) {
            adimlar.append(",\"h\":{").append(h).append('}');
        }
        adimlar.append(",\"b\":").append(bayt);
        if (!bekleyen.isEmpty()) {
            adimlar.append(",\"n\":").append(js(String.join(" ", bekleyen)));
            bekleyen.clear();
        }
        adimlar.append('}');
        adimSayisi++;
    }

    private String durum(ObjectReference o, Deque<ObjectReference> kuyruk) {
        StringBuilder b = new StringBuilder("[");
        String tip = kisa(o.referenceType().name());
        b.append(js(tip)).append(",[");
        if (o instanceof ArrayReference ar) {
            int n = ar.length();
            List<Value> el = n == 0 ? List.of() : ar.getValues(0, Math.min(n, DIZI_SINIRI));
            for (int i = 0; i < el.size(); i++) {
                if (i > 0) {
                    b.append(',');
                }
                b.append(js(deger(el.get(i), kuyruk)));
            }
            if (n > DIZI_SINIRI) {
                b.append(',').append(js("… +" + (n - DIZI_SINIRI)));
            }
        } else if (atilabilir(o)) {
            String m = mesaj(o);
            b.append("[").append(js("mesaj")).append(',').append(js(m == null ? "null" : tirnak(m))).append(']');
        } else {
            boolean ilk = true;
            for (Field f : o.referenceType().allFields()) {
                if (f.isStatic() || f.isSynthetic()) {
                    continue;
                }
                if (!ilk) {
                    b.append(',');
                }
                ilk = false;
                b.append('[').append(js(f.name())).append(',').append(js(deger(o.getValue(f), kuyruk))).append(']');
            }
        }
        return b.append("]]").toString();
    }

    // ---------------------------------------------------------------- değerler

    private int no(ObjectReference o) {
        return kimlik.computeIfAbsent(o.uniqueID(), k -> kimlik.size() + 1);
    }

    private String deger(Value v) {
        return deger(v, null);
    }

    private String deger(Value v, Deque<ObjectReference> kuyruk) {
        if (v == null) {
            return "null";
        }
        if (v instanceof StringReference s) {
            return tirnak(s.value());
        }
        if (v instanceof CharValue c) {
            return "'" + kacis(String.valueOf(c.value()), '\'') + "'";
        }
        if (v instanceof BooleanValue x) {
            return String.valueOf(x.value());
        }
        if (v instanceof IntegerValue x) {
            return String.valueOf(x.value());
        }
        if (v instanceof LongValue x) {
            return String.valueOf(x.value());
        }
        if (v instanceof ShortValue x) {
            return String.valueOf(x.value());
        }
        if (v instanceof ByteValue x) {
            return String.valueOf(x.value());
        }
        if (v instanceof DoubleValue x) {
            return Double.toString(x.value());
        }
        if (v instanceof FloatValue x) {
            return Float.toString(x.value());
        }
        if (v instanceof ObjectReference o) {
            String tip = o.referenceType().name();
            if (o instanceof ArrayReference || kullanici.contains(tip) || atilabilir(o)) {
                if (kuyruk != null) {
                    kuyruk.add(o);
                }
                return "#" + no(o);
            }
            Field f = o.referenceType().fieldByName("value");
            if (f != null && tip.startsWith("java.lang.") && !tip.equals("java.lang.String")) {
                return deger(o.getValue(f), kuyruk); // Integer, Double gibi sarmalayıcılar
            }
            return kisa(tip);
        }
        return v.toString();
    }

    private static boolean atilabilir(ObjectReference o) {
        if (!(o.referenceType() instanceof ClassType ct)) {
            return false;
        }
        for (ClassType c = ct; c != null; c = c.superclass()) {
            if (c.name().equals("java.lang.Throwable")) {
                return true;
            }
        }
        return false;
    }

    private static String mesaj(ObjectReference ist) {
        try {
            Field f = ist.referenceType().fieldByName("detailMessage");
            Value v = f == null ? null : ist.getValue(f);
            return v instanceof StringReference s ? s.value() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String kisa(String tip) {
        int i = tip.lastIndexOf('.');
        return i < 0 ? tip : tip.substring(i + 1);
    }

    private static String tirnak(String s) {
        return "\"" + kacis(s, '"') + "\"";
    }

    private static String kacis(String s, char tirnak) {
        StringBuilder b = new StringBuilder();
        for (char c : s.toCharArray()) {
            switch (c) {
                case '\n' -> b.append("\\n");
                case '\t' -> b.append("\\t");
                case '\r' -> b.append("\\r");
                case '\\' -> b.append("\\\\");
                default -> {
                    if (c == tirnak) {
                        b.append('\\');
                    }
                    b.append(c);
                }
            }
        }
        return b.toString();
    }

    private static String uclu(String a, String b, String c) {
        return "[" + js(a) + "," + js(b) + "," + js(c) + "]";
    }

    private static String js(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                default -> {
                    if (c < 0x20) {
                        b.append(String.format("\\u%04x", (int) c));
                    } else {
                        b.append(c);
                    }
                }
            }
        }
        return b.append('"').toString();
    }
}
