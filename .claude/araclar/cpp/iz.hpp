// cpp-iz.py yardımcısı: adım adım izlenecek programa -include ile eklenir. Araç her deyimin önüne
// __iz::A(satır, {değişkenler}), her if/for/while/do koşuluna __iz::K(...) çağrısı yerleştirir.
// Değerler Visual Studio'nun Locals penceresindeki gibi yazılır: metin tırnaklı, karakter kodlu
// (65 'A'), ondalık en kısa biçimde, bool true/false. Değer almamış değişken "?" görünür: araç
// ilk değersiz tanımlardan sonra __iz::bos çağırır, bellek değişmediği sürece değer yok sayılır.
#pragma once
#include <charconv>
#include <cstddef>
#include <cstring>
#include <initializer_list>
#include <string>
#include <type_traits>
#include <unordered_set>

namespace __iz
{
extern long long yazilan;
extern bool _k;

struct D
{
    const char* ad;
    std::string deger;
    const char* tur;
};

inline std::unordered_set<const void*>& bosKume()
{
    static std::unordered_set<const void*> k;
    return k;
}

inline void bos(void* p, std::size_t n)
{
    std::memset(p, 0xA5, n);
    bosKume().insert(p);
}

inline bool halaBos(const void* p, std::size_t n)
{
    auto& k = bosKume();
    auto it = k.find(p);
    if (it == k.end()) return false;
    const unsigned char* b = static_cast<const unsigned char*>(p);
    for (std::size_t i = 0; i < n; i++)
    {
        if (b[i] != 0xA5)
        {
            k.erase(it);
            return false;
        }
    }
    return true;
}

inline std::string kacis(char c)
{
    switch (c)
    {
        case '\n': return "\\n";
        case '\t': return "\\t";
        case '\r': return "\\r";
        case '\0': return "\\0";
        case '\\': return "\\\\";
        default: return std::string(1, c);
    }
}

inline std::string bicim(bool x) { return x ? "true" : "false"; }

inline std::string bicim(char c)
{
    std::string s = std::to_string(static_cast<int>(c)) + " '";
    s += c == '\'' ? std::string("\\'") : kacis(c);
    return s + "'";
}

inline std::string bicim(const std::string& s)
{
    std::string o = "\"";
    for (char c : s) o += c == '"' ? std::string("\\\"") : kacis(c);
    return o + "\"";
}

inline std::string bicim(double d)
{
    char b[64];
    auto r = std::to_chars(b, b + sizeof b, d);
    return std::string(b, r.ptr);
}

inline std::string bicim(float f)
{
    char b[64];
    auto r = std::to_chars(b, b + sizeof b, f);
    return std::string(b, r.ptr);
}

inline std::string bicim(long double d) { return bicim(static_cast<double>(d)); }

template <class T>
std::enable_if_t<std::is_integral_v<T> && !std::is_same_v<T, bool> && !std::is_same_v<T, char>, std::string> bicim(T x)
{
    return std::to_string(x);
}

template <class T>
D v(const char* ad, const T& x, const char* tur)
{
    if (halaBos(&x, sizeof(T))) return {ad, "?", tur};
    return {ad, bicim(x), tur};
}

void A(int satir, std::initializer_list<D> d);
bool K(int satir, const char* metin, bool sonuc, std::initializer_list<D> d);
}
