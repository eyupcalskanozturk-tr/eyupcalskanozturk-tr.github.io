// programlama-iz.py yardımcısı: her programa eklenir, Main'den önce çalışır ([ModuleInitializer]).
// Kültürü tr-TR yapar (Türkçe Windows'taki gibi: 2,5 · ₺), konsola yazılan karakterleri sayar ve
// Console.ReadLine ile okunan her satırı çıktıya \u0001satır\u0002 işaretiyle yankılar
// (Visual Studio konsolunda yazılan girdinin yerini bulmak için).
using System;
using System.Globalization;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text;

static class __Calistirici
{
    public static long Yazilan;

    [ModuleInitializer]
    internal static void Kur()
    {
        var tr = new CultureInfo("tr-TR");
        CultureInfo.DefaultThreadCurrentCulture = tr;
        CultureInfo.DefaultThreadCurrentUICulture = tr;
        CultureInfo.CurrentCulture = tr;
        CultureInfo.CurrentUICulture = tr;
        var ham = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        var sayan = new __SayanYazici(ham);
        Console.SetOut(sayan);
        Console.SetIn(new __EkoOkuyucu(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)), sayan));
    }
}

sealed class __SayanYazici : TextWriter
{
    private readonly TextWriter ic;
    public __SayanYazici(TextWriter ic) { this.ic = ic; NewLine = "\n"; }
    public override Encoding Encoding => Encoding.UTF8;
    public override void Write(char value) { ic.Write(value); __Calistirici.Yazilan++; }
    public override void Write(string value) { if (value == null) return; ic.Write(value); __Calistirici.Yazilan += value.Length; }
    public override void Write(char[] buffer, int index, int count) { ic.Write(buffer, index, count); __Calistirici.Yazilan += count; }
    public override void Flush() => ic.Flush();
}

sealed class __EkoOkuyucu : TextReader
{
    private readonly TextReader ic;
    private readonly TextWriter yanki;
    public __EkoOkuyucu(TextReader ic, TextWriter yanki) { this.ic = ic; this.yanki = yanki; }
    public override string ReadLine()
    {
        string s = ic.ReadLine();
        if (s == null && Environment.GetEnvironmentVariable("GIRDI_BITTI_DUR") == "1")
        {
            // Senaryodaki girdi yetmedi: ReadLine null döner, Convert.ToInt32(null) 0 verir ve döngü sonsuza
            // gidebilir. Araç bu durumda programı durdurur ve senaryoyu düzeltmeni ister.
            Console.Error.WriteLine("\u0003girdi bitti");
            Environment.Exit(97);
        }
        if (s != null)
        {
            yanki.Write('\u0001');
            yanki.Write(s);
            yanki.Write('\u0002');
            yanki.Write('\n');
        }
        return s;
    }
    public override int Read() => ic.Read();
    public override int Peek() => ic.Peek();
}
