// cpp-iz.py yardımcısı: her programa bağlanır ve main'den önce çalışır (statik nesne).
// - stdout'u Windows konsolundaki gibi tamponsuz yapar (program çökse de yazılan görünür),
// - cout'a yazılan baytları sayar (adım adım izde "o ana kadarki çıktı" için),
// - cin'in okuduğu her satırı çıktıya \x01satır\x02 işaretiyle yankılar (konsolda klavyeden
//   yazılanın yerini bulmak için). Girdi bitince GIRDI_BITTI_DUR=1 ise program 97 koduyla durur.
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <streambuf>
#include <string>
#include <unistd.h>

namespace __iz
{
long long yazilan = 0;
}

namespace
{
class SayanBuf : public std::streambuf
{
    std::streambuf* ic;

public:
    explicit SayanBuf(std::streambuf* ic) : ic(ic) {}

protected:
    int_type overflow(int_type c) override
    {
        if (traits_type::eq_int_type(c, traits_type::eof())) return traits_type::not_eof(c);
        __iz::yazilan++;
        return ic->sputc(traits_type::to_char_type(c));
    }
    std::streamsize xsputn(const char* s, std::streamsize n) override
    {
        __iz::yazilan += n;
        return ic->sputn(s, n);
    }
    int sync() override { return ic->pubsync(); }
};

class EkoBuf : public std::streambuf
{
    std::streambuf* ic;
    std::ostream* yanki;
    std::string satir;

public:
    EkoBuf(std::streambuf* ic, std::ostream* yanki) : ic(ic), yanki(yanki) {}

protected:
    int_type underflow() override
    {
        if (gptr() < egptr()) return traits_type::to_int_type(*gptr());
        satir.clear();
        int_type c;
        while (!traits_type::eq_int_type(c = ic->sbumpc(), traits_type::eof()))
        {
            satir.push_back(traits_type::to_char_type(c));
            if (c == '\n') break;
        }
        if (satir.empty())
        {
            const char* dur = std::getenv("GIRDI_BITTI_DUR");
            if (dur && dur[0] == '1')
            {
                std::fputs("\x03girdi bitti\n", stderr);
                std::fflush(nullptr);
                _exit(97);
            }
            return traits_type::eof();
        }
        std::string gorunen = satir;
        if (!gorunen.empty() && gorunen.back() == '\n') gorunen.pop_back();
        if (!gorunen.empty() && gorunen.back() == '\r') gorunen.pop_back();
        *yanki << '\x01' << gorunen << '\x02' << '\n';
        setg(&satir[0], &satir[0], &satir[0] + satir.size());
        return traits_type::to_int_type(*gptr());
    }
};

struct Kurulum
{
    Kurulum()
    {
        std::setvbuf(stdout, nullptr, _IONBF, 0);
        static SayanBuf sayan(std::cout.rdbuf());
        std::cout.rdbuf(&sayan);
        static EkoBuf eko(std::cin.rdbuf(), &std::cout);
        std::cin.rdbuf(&eko);
    }
} kurulum;
}
