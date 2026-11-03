// cpp-iz.py yardımcısı: izli derlemeye bağlanır. Adımları IZ_DOSYA ortam değişkenindeki dosyaya
// JSON satırları olarak yazar: {"l":satır,"o":o ana kadar yazılan bayt,"k":"koşul","r":sonuç,"v":[[ad,değer,tür],…]}
// Her satırdan sonra dosya boşaltılır: program sıfıra bölmeyle çökse de o ana kadarki iz kalır.
#include "iz.hpp"

#include <cstdio>
#include <cstdlib>
#include <string>

namespace __iz
{
bool _k = false;

namespace
{
FILE* dosya = nullptr;
int sayi = 0;
int enCok = 600;
bool hazir = false;

void hazirla()
{
    if (hazir) return;
    hazir = true;
    const char* yol = std::getenv("IZ_DOSYA");
    if (yol && *yol) dosya = std::fopen(yol, "w");
    const char* e = std::getenv("IZ_EN_COK");
    if (e && *e) enCok = std::atoi(e);
}

void js(std::string& o, const std::string& s)
{
    o += '"';
    for (unsigned char c : s)
    {
        switch (c)
        {
            case '"': o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n"; break;
            case '\r': o += "\\r"; break;
            case '\t': o += "\\t"; break;
            default:
                if (c < 0x20)
                {
                    char b[8];
                    std::snprintf(b, sizeof b, "\\u%04x", c);
                    o += b;
                }
                else
                {
                    o += static_cast<char>(c);
                }
        }
    }
    o += '"';
}

void yaz(int satir, const char* kosul, bool sonuc, std::initializer_list<D> d)
{
    hazirla();
    if (!dosya) return;
    if (sayi >= enCok)
    {
        if (sayi == enCok)
        {
            std::fputs("{\"kesildi\":true}\n", dosya);
            std::fflush(dosya);
            sayi++;
        }
        return;
    }
    sayi++;
    std::string o = "{\"l\":" + std::to_string(satir) + ",\"o\":" + std::to_string(yazilan);
    if (kosul)
    {
        o += ",\"k\":";
        js(o, kosul);
        o += sonuc ? ",\"r\":true" : ",\"r\":false";
    }
    o += ",\"v\":[";
    bool ilk = true;
    for (const D& x : d)
    {
        if (!ilk) o += ',';
        ilk = false;
        o += '[';
        js(o, x.ad);
        o += ',';
        js(o, x.deger);
        o += ',';
        js(o, x.tur);
        o += ']';
    }
    o += "]}\n";
    std::fputs(o.c_str(), dosya);
    std::fflush(dosya);
}
}

void A(int satir, std::initializer_list<D> d) { yaz(satir, nullptr, false, d); }

bool K(int satir, const char* metin, bool sonuc, std::initializer_list<D> d)
{
    yaz(satir, metin, sonuc, d);
    return sonuc;
}
}
