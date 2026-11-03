// programlama-iz.py yardımcısı: adım adım izlenen programa eklenir. Derleyici her deyimden önce
// __Iz.A(...), her if/for/while/do koşuluna __Iz.K(...) çağrısı yerleştirir. Adımlar IZ_DOSYA
// ortam değişkenindeki dosyaya JSON satırları olarak yazılır.
using System;
using System.Globalization;
using System.IO;
using System.Text;

static class __Iz
{
    private static readonly StreamWriter dosya;
    private static int sayi;
    private static readonly int enCok;

    static __Iz()
    {
        string yol = Environment.GetEnvironmentVariable("IZ_DOSYA");
        enCok = int.TryParse(Environment.GetEnvironmentVariable("IZ_EN_COK"), out int n) ? n : 600;
        if (!string.IsNullOrEmpty(yol))
        {
            dosya = new StreamWriter(yol, false, new UTF8Encoding(false)) { AutoFlush = true };
        }
    }

    public static void A(int satir, object[] d) => Yaz(satir, null, false, d);

    public static bool K(int satir, string metin, bool sonuc, object[] d)
    {
        Yaz(satir, metin, sonuc, d);
        return sonuc;
    }

    private static void Yaz(int satir, string kosul, bool sonuc, object[] d)
    {
        if (dosya == null || sayi >= enCok)
        {
            if (sayi == enCok && dosya != null) { dosya.WriteLine("{\"kesildi\":true}"); sayi++; }
            return;
        }
        sayi++;
        var b = new StringBuilder();
        b.Append("{\"l\":").Append(satir).Append(",\"o\":").Append(__Calistirici.Yazilan);
        if (kosul != null)
        {
            b.Append(",\"k\":").Append(Js(kosul)).Append(",\"r\":").Append(sonuc ? "true" : "false");
        }
        b.Append(",\"v\":[");
        for (int i = 0; i + 2 < d.Length; i += 3)
        {
            if (i > 0) b.Append(',');
            b.Append('[').Append(Js((string)d[i])).Append(',').Append(Js(Bicim(d[i + 1]))).Append(',').Append(Js((string)d[i + 2])).Append(']');
        }
        b.Append("]}");
        dosya.WriteLine(b.ToString());
    }

    // Değeri Visual Studio'nun Locals penceresindeki gibi yazar: metin tırnaklı, karakter kodlu (65 'A'),
    // ondalık noktalı, bool küçük harf, nesne süslü parantezli ({System.Random}).
    private static string Bicim(object v)
    {
        switch (v)
        {
            case null: return "null";
            case string s: return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\t", "\\t") + "\"";
            case char c: return (int)c + " " + (c == '\n' ? "'\\n'" : c == '\t' ? "'\\t'" : c == ' ' ? "' '" : "'" + c + "'");
            case bool x: return x ? "true" : "false";
            case IFormattable f when v.GetType().IsPrimitive || v is decimal: return f.ToString(null, CultureInfo.InvariantCulture);
            default: return "{" + v + "}";
        }
    }

    private static string Js(string s)
    {
        var b = new StringBuilder("\"");
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': b.Append("\\\""); break;
                case '\\': b.Append("\\\\"); break;
                case '\n': b.Append("\\n"); break;
                case '\r': b.Append("\\r"); break;
                case '\t': b.Append("\\t"); break;
                default:
                    if (c < ' ') b.Append("\\u").Append(((int)c).ToString("x4")); else b.Append(c);
                    break;
            }
        }
        return b.Append('"').ToString();
    }
}
