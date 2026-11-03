// programlama-iz.py'nin derleyicisi: Roslyn'i (SDK'nın kendi Microsoft.CodeAnalysis kitaplıkları) tek
// süreçte çalıştırıp sayfadaki bütün C# programlarını hızlıca derler.
//
//   dotnet Derleyici.dll <isler.json>
//
// isler.json: {"referanslar": "<ref/net8.0 klasörü>", "yardimcilar": ["…/Calistirici.cs"], "iz": "…/Iz.cs",
//              "isler": [{"id": "…", "dosyalar": [{"ad": "Program.cs", "yol": "…"}], "izle": true, "cikti": "…/prog.dll"}]}
// Her iş için stdout'a bir JSON satırı yazar: {"id","ok","hatalar":[…],"uyarilar":[…]}.
// "izle" açıksa her deyimin önüne __Iz.A(satır, değişkenler), her if/for/while/do koşuluna
// __Iz.K(satır, "koşul", sonuç, değişkenler) yerleştirir; değişkenler o noktada kapsamda olan,
// bildirilmiş ve kesin atanmış yerel değişkenlerdir (Roslyn SemanticModel + DataFlowAnalysis).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Emit;

static class Derleyici
{
    static readonly CultureInfo Tr = new CultureInfo("tr-TR");

    static int Main(string[] args)
    {
        var kok = JsonDocument.Parse(File.ReadAllText(args[0])).RootElement;
        var refs = Directory.GetFiles(kok.GetProperty("referanslar").GetString(), "*.dll")
            .Select(p => (MetadataReference)MetadataReference.CreateFromFile(p)).ToList();
        var parse = new CSharpParseOptions(LanguageVersion.Latest);
        var yardimcilar = kok.GetProperty("yardimcilar").EnumerateArray()
            .Select(e => CSharpSyntaxTree.ParseText(File.ReadAllText(e.GetString()), parse, Path.GetFileName(e.GetString()), Encoding.UTF8)).ToList();
        string izYolu = kok.GetProperty("iz").GetString();
        var izAgaci = CSharpSyntaxTree.ParseText(File.ReadAllText(izYolu), parse, Path.GetFileName(izYolu), Encoding.UTF8);
        var secenek = new CSharpCompilationOptions(OutputKind.ConsoleApplication,
            optimizationLevel: OptimizationLevel.Debug, nullableContextOptions: NullableContextOptions.Disable);
        var cikti = Console.Out;

        foreach (var j in kok.GetProperty("isler").EnumerateArray())
        {
            string id = j.GetProperty("id").GetString();
            var kullanici = j.GetProperty("dosyalar").EnumerateArray().Select(d =>
                CSharpSyntaxTree.ParseText(File.ReadAllText(d.GetProperty("yol").GetString()), parse, d.GetProperty("ad").GetString(), Encoding.UTF8)).ToList();
            bool izle = j.TryGetProperty("izle", out var iz) && iz.GetBoolean();
            string hedef = j.GetProperty("cikti").GetString();
            var agaclar = new List<SyntaxTree>();
            if (izle)
            {
                var analiz = CSharpCompilation.Create("analiz", kullanici.Concat(yardimcilar), refs, secenek);
                if (analiz.GetDiagnostics().Any(d => d.Severity == DiagnosticSeverity.Error))
                {
                    izle = false; // önce düz derlemede hatalar raporlanır
                }
                else
                {
                    foreach (var agac in kullanici)
                    {
                        var yeni = new Izleyici(analiz.GetSemanticModel(agac)).Visit(agac.GetRoot());
                        agaclar.Add(CSharpSyntaxTree.ParseText(yeni.ToFullString(), parse, agac.FilePath, Encoding.UTF8));
                    }
                    agaclar.AddRange(yardimcilar);
                    agaclar.Add(izAgaci);
                }
            }
            if (!izle)
            {
                agaclar.Clear();
                agaclar.AddRange(kullanici);
                agaclar.AddRange(yardimcilar);
            }
            Directory.CreateDirectory(Path.GetDirectoryName(hedef));
            EmitResult sonuc = Yaz(hedef, agaclar, refs, secenek);
            if (izle && !sonuc.Success)
            {
                // İzleme eklenmiş kod derlenmediyse (araçtaki bir eksik) program izsiz derlenir; sebep stderr'e yazılır.
                Console.Error.WriteLine(id + ": izli derleme başarısız, izsiz derleniyor");
                foreach (var d in sonuc.Diagnostics.Where(d => d.Severity == DiagnosticSeverity.Error).Take(5))
                {
                    Console.Error.WriteLine("  " + d);
                }
                izle = false;
                agaclar.Clear();
                agaclar.AddRange(kullanici);
                agaclar.AddRange(yardimcilar);
                sonuc = Yaz(hedef, agaclar, refs, secenek);
            }
            File.WriteAllText(Path.ChangeExtension(hedef, ".runtimeconfig.json"),
                "{\"runtimeOptions\":{\"tfm\":\"net8.0\",\"framework\":{\"name\":\"Microsoft.NETCore.App\",\"version\":\"8.0.0\"}}}");
            var uyarilar = sonuc.Diagnostics.Where(d => d.Severity == DiagnosticSeverity.Warning && kullanici.Any(k => k.FilePath == d.Location.SourceTree?.FilePath));
            var b = new StringBuilder();
            b.Append("{\"id\":").Append(Js(id)).Append(",\"ok\":").Append(sonuc.Success ? "true" : "false").Append(",\"izli\":").Append(izle ? "true" : "false");
            b.Append(",\"hatalar\":[").Append(string.Join(",", sonuc.Diagnostics.Where(d => d.Severity == DiagnosticSeverity.Error).Select(Tani))).Append(']');
            b.Append(",\"uyarilar\":[").Append(string.Join(",", uyarilar.Select(Tani))).Append("]}");
            cikti.WriteLine(b.ToString());
        }
        return 0;
    }

    static EmitResult Yaz(string hedef, List<SyntaxTree> agaclar, List<MetadataReference> refs, CSharpCompilationOptions secenek)
    {
        var derleme = CSharpCompilation.Create(Path.GetFileNameWithoutExtension(hedef), agaclar, refs, secenek);
        using var dll = File.Create(hedef);
        using var pdb = File.Create(Path.ChangeExtension(hedef, ".pdb"));
        return derleme.Emit(dll, pdb, options: new EmitOptions(debugInformationFormat: DebugInformationFormat.PortablePdb));
    }

    static string Tani(Diagnostic d)
    {
        var yer = d.Location.GetLineSpan();
        return "{\"kod\":" + Js(d.Id) + ",\"dosya\":" + Js(yer.Path ?? "") + ",\"satir\":" + (yer.StartLinePosition.Line + 1)
            + ",\"sutun\":" + (yer.StartLinePosition.Character + 1) + ",\"mesaj\":" + Js(d.GetMessage(CultureInfo.InvariantCulture))
            + ",\"mesaj_tr\":" + Js(d.GetMessage(Tr)) + "}";
    }

    internal static string Js(string s)
    {
        var b = new StringBuilder("\"");
        foreach (char c in s ?? "")
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

/// Deyimlerin önüne ve koşulların içine izleme çağrıları yerleştirir.
sealed class Izleyici : CSharpSyntaxRewriter
{
    private readonly SemanticModel m;

    public Izleyici(SemanticModel m) { this.m = m; }

    private static int Satir(SyntaxNode n) => n.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
    private static int Satir(SyntaxToken t) => t.GetLocation().GetLineSpan().StartLinePosition.Line + 1;

    private static bool YontemIcinde(SyntaxNode n) =>
        n.Ancestors().Any(a => a is BaseMethodDeclarationSyntax || a is LocalFunctionStatementSyntax || a is AccessorDeclarationSyntax);

    private string Degiskenler(int konum, ISet<ISymbol> atanmis)
    {
        var parca = new List<string>();
        var semboller = m.LookupSymbols(konum).Where(s => s is ILocalSymbol || s is IParameterSymbol)
            .OrderBy(s => s.Locations.FirstOrDefault()?.SourceSpan.Start ?? 0);
        foreach (var s in semboller)
        {
            var bildirim = s.DeclaringSyntaxReferences.FirstOrDefault();
            if (bildirim == null || bildirim.SyntaxTree != m.SyntaxTree || bildirim.Span.Start >= konum) continue;
            if (s is IParameterSymbol p && p.Name == "args") continue;
            if (atanmis != null && !atanmis.Contains(s)) continue;
            ITypeSymbol t = s is ILocalSymbol l ? l.Type : ((IParameterSymbol)s).Type;
            if (t.IsRefLikeType || (s is ILocalSymbol yl && yl.IsRef)) continue;
            parca.Add(Derleyici.Js(s.Name) + ", (object)" + s.Name + ", " + Derleyici.Js(t.ToDisplayString(SymbolDisplayFormat.CSharpErrorMessageFormat)));
        }
        return "new object[]{" + string.Join(", ", parca) + "}";
    }

    private ISet<ISymbol> Atanmis(DataFlowAnalysis df, bool giris)
    {
        if (df == null || !df.Succeeded) return null;
        if (giris) return new HashSet<ISymbol>(df.DefinitelyAssignedOnEntry, SymbolEqualityComparer.Default);
        // Yöntem sonu: bölgenin içinde bildirilip her yolda atanan değişkenler de sayılır.
        var k = new HashSet<ISymbol>(df.DefinitelyAssignedOnExit, SymbolEqualityComparer.Default);
        k.UnionWith(df.AlwaysAssigned);
        return k;
    }

    private StatementSyntax Adim(StatementSyntax st)
    {
        DataFlowAnalysis df = null;
        try { df = m.AnalyzeDataFlow(st); } catch (Exception) { /* bazı deyimlerde analiz yok */ }
        string metin = "global::__Iz.A(" + Satir(st) + ", " + Degiskenler(st.SpanStart, Atanmis(df, true)) + ");";
        return SyntaxFactory.ParseStatement(metin).WithTrailingTrivia(SyntaxFactory.ElasticSpace);
    }

    private ExpressionSyntax Kosul(ExpressionSyntax kosul, ExpressionSyntax ziyaretli)
    {
        if (kosul is LiteralExpressionSyntax) return ziyaretli;
        DataFlowAnalysis df = null;
        try { df = m.AnalyzeDataFlow(kosul); } catch (Exception) { }
        string metin = "global::__Iz.K(" + Satir(kosul) + ", " + SymbolDisplay.FormatLiteral(kosul.ToString(), true) + ", ("
            + ziyaretli.ToFullString() + "), " + Degiskenler(kosul.SpanStart, Atanmis(df, true)) + ")";
        return SyntaxFactory.ParseExpression(metin);
    }

    private static bool Izlenir(StatementSyntax st) =>
        !(st is BlockSyntax || st is LocalFunctionStatementSyntax || st is EmptyStatementSyntax);

    private SyntaxList<StatementSyntax> Liste(SyntaxList<StatementSyntax> deyimler)
    {
        var yeni = new List<StatementSyntax>();
        foreach (var st in deyimler)
        {
            if (Izlenir(st)) yeni.Add(Adim(st));
            yeni.Add((StatementSyntax)Visit(st));
        }
        return SyntaxFactory.List(yeni);
    }

    private StatementSyntax Gom(StatementSyntax st)
    {
        if (st is BlockSyntax || st == null) return (StatementSyntax)Visit(st);
        return SyntaxFactory.Block(Adim(st), (StatementSyntax)Visit(st));
    }

    public override SyntaxNode VisitBlock(BlockSyntax node)
    {
        if (!YontemIcinde(node)) return base.VisitBlock(node);
        var yeni = node.WithStatements(Liste(node.Statements));
        if (node.Parent is MethodDeclarationSyntax yontem && node.Statements.Count > 0)
        {
            DataFlowAnalysis df = null;
            try { df = m.AnalyzeDataFlow(node.Statements.First(), node.Statements.Last()); } catch (Exception) { }
            // Kapanış parantezinin üstünde LookupSymbols bloğun dışını görür; son deyimin hemen sonrası bloğun içidir.
            int konum = node.Statements.Last().Span.End;
            string son = "global::__Iz.A(" + Satir(node.CloseBraceToken) + ", " + Degiskenler(konum, Atanmis(df, false)) + ");";
            bool donusVar = !yontem.ReturnType.ToString().Equals("void");
            if (!donusVar) yeni = yeni.AddStatements(SyntaxFactory.ParseStatement(son));
        }
        return yeni;
    }

    public override SyntaxNode VisitSwitchSection(SwitchSectionSyntax node)
    {
        var etiketler = node.Labels.Select(l => (SwitchLabelSyntax)Visit(l));
        return node.WithLabels(SyntaxFactory.List(etiketler)).WithStatements(Liste(node.Statements));
    }

    public override SyntaxNode VisitIfStatement(IfStatementSyntax node)
    {
        var kosul = Kosul(node.Condition, (ExpressionSyntax)Visit(node.Condition));
        var govde = Gom(node.Statement);
        var yeni = node.WithCondition(kosul).WithStatement(govde);
        if (node.Else != null)
        {
            var e = node.Else.Statement is IfStatementSyntax ? (StatementSyntax)Visit(node.Else.Statement) : Gom(node.Else.Statement);
            yeni = yeni.WithElse(node.Else.WithStatement(e));
        }
        return yeni;
    }

    public override SyntaxNode VisitForStatement(ForStatementSyntax node)
    {
        var yeni = (ForStatementSyntax)base.VisitForStatement(node);
        if (node.Condition != null) yeni = yeni.WithCondition(Kosul(node.Condition, (ExpressionSyntax)Visit(node.Condition)));
        return yeni.WithStatement(Gom(node.Statement));
    }

    public override SyntaxNode VisitWhileStatement(WhileStatementSyntax node) =>
        node.WithCondition(Kosul(node.Condition, (ExpressionSyntax)Visit(node.Condition))).WithStatement(Gom(node.Statement));

    public override SyntaxNode VisitDoStatement(DoStatementSyntax node) =>
        node.WithCondition(Kosul(node.Condition, (ExpressionSyntax)Visit(node.Condition))).WithStatement(Gom(node.Statement));

    public override SyntaxNode VisitForEachStatement(ForEachStatementSyntax node) =>
        node.WithExpression((ExpressionSyntax)Visit(node.Expression)).WithStatement(Gom(node.Statement));
}
