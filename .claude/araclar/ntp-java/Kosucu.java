import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * ntp-vize-iz.py'nin çalıştırıcısı: java Kosucu Main [argümanlar...]
 *
 * Programı aynı JVM'de başlatır. Klavye girdisini Scanner'a satır satır verir, verdiği satırı
 * standart çıktıya \u0001satır\u0002 işaretiyle yankılar (IntelliJ konsolunda yazılan girdinin
 * yerini bulmak için). Yakalanmayan istisnayı JVM'in kendi biçiminde yazar ve 1 ile çıkar.
 */
public final class Kosucu {
    /** Standart çıktıya şimdiye kadar yazılan bayt sayısı; Izci her adımda okur. */
    public static volatile long yazilan;

    private Kosucu() {
    }

    public static void main(String[] args) throws Exception {
        PrintStream ham = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        OutputStream sayan = new OutputStream() {
            @Override
            public void write(int b) {
                ham.write(b);
                yazilan++;
            }

            @Override
            public void write(byte[] b, int o, int n) {
                ham.write(b, o, n);
                yazilan += n;
            }

            @Override
            public void flush() {
                ham.flush();
            }
        };
        PrintStream out = new PrintStream(sayan, true, StandardCharsets.UTF_8);
        System.setOut(out);
        System.setIn(new SatirSatir(new BufferedInputStream(new FileInputStream(FileDescriptor.in)), out));

        Method m = Class.forName(args[0]).getMethod("main", String[].class);
        try {
            m.invoke(null, (Object) Arrays.copyOfRange(args, 1, args.length));
        } catch (InvocationTargetException e) {
            Throwable t = e.getCause();
            kirp(t);
            out.flush();
            System.err.print("Exception in thread \"main\" ");
            t.printStackTrace();
            System.err.flush();
            System.exit(1);
        }
        out.flush();
    }

    /** Yığın izini Main.main'de bitirir: yansıtma ve Kosucu satırları gerçek çalıştırmada yoktur. */
    private static void kirp(Throwable t) {
        for (Throwable x = t; x != null; x = x.getCause()) {
            StackTraceElement[] st = x.getStackTrace();
            int k = 0;
            while (k < st.length && !st[k].getClassName().startsWith("jdk.internal.reflect.")
                    && !st[k].getClassName().equals("java.lang.reflect.Method")
                    && !st[k].getClassName().equals(Kosucu.class.getName())) {
                k++;
            }
            x.setStackTrace(Arrays.copyOf(st, k));
            if (x.getCause() == x) {
                break;
            }
        }
    }
}

/** Girdiyi bir seferde en çok bir satır verir; her yeni satırı çıktıya işaretli yankılar. */
final class SatirSatir extends InputStream {
    private final InputStream ic;
    private final PrintStream yanki;
    private byte[] satir = new byte[0];
    private int konum;

    SatirSatir(InputStream ic, PrintStream yanki) {
        this.ic = ic;
        this.yanki = yanki;
    }

    private boolean doldur() throws IOException {
        if (konum < satir.length) {
            return true;
        }
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = ic.read()) != -1) {
            b.write(c);
            if (c == '\n') {
                break;
            }
        }
        if (b.size() == 0) {
            return false;
        }
        satir = b.toByteArray();
        konum = 0;
        int n = satir.length;
        if (satir[n - 1] == '\n') {
            n--;
        }
        if (n > 0 && satir[n - 1] == '\r') {
            n--;
        }
        yanki.write(1);
        yanki.write(satir, 0, n);
        yanki.write(2);
        yanki.write('\n');
        yanki.flush();
        return true;
    }

    @Override
    public int read() throws IOException {
        return doldur() ? satir[konum++] & 0xff : -1;
    }

    @Override
    public int read(byte[] b, int o, int n) throws IOException {
        if (n == 0) {
            return 0;
        }
        if (!doldur()) {
            return -1;
        }
        int k = Math.min(n, satir.length - konum);
        System.arraycopy(satir, konum, b, o, k);
        konum += k;
        return k;
    }

    @Override
    public int available() {
        return satir.length - konum;
    }
}
