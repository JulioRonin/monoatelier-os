"""El doctor tiene que DECIR lo que falla: un ✗ que no se imprime deja
"arregla las líneas con ✗" apuntando a nada."""

from forge_agent import doctor


def test_sin_llave_de_anthropic_se_imprime_el_motivo(monkeypatch, capsys):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert doctor.revisar_lectura() is False
    salida = capsys.readouterr().out
    assert "✗" in salida and "ANTHROPIC_API_KEY" in salida


def test_con_llave_la_lectura_queda_en_verde(monkeypatch, capsys):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-prueba")
    assert doctor.revisar_lectura(verificar=False) is True


def test_cada_falla_del_resumen_tiene_su_linea(monkeypatch, capsys):
    # sin llave ni Supabase: el cierre pide arreglar ✗, y debe haber al menos uno
    for v in ("ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_KEY", "FORGE_PROVEEDOR"):
        monkeypatch.delenv(v, raising=False)
    codigo = doctor.main()
    salida = capsys.readouterr().out
    if "Arregla las líneas con ✗" in salida:
        assert codigo == 1
        assert salida.count("✗") >= 2, salida


def test_la_llave_con_comillas_se_limpia_y_se_avisa(monkeypatch):
    from forge_agent import llave_anthropic, problemas_de_llave
    real = "sk-ant-api03-" + "x" * 95
    monkeypatch.setenv("ANTHROPIC_API_KEY", f' "{real}" ')
    assert llave_anthropic() == real
    assert any("comillas" in p for p in problemas_de_llave())


def test_el_texto_de_ejemplo_se_reconoce(monkeypatch):
    from forge_agent import problemas_de_llave
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-...")
    assert any("EJEMPLO" in p for p in problemas_de_llave())


def test_una_llave_rechazada_se_dice_con_su_huella(monkeypatch, capsys):
    import anthropic

    class _Modelos:
        def retrieve(self, m):
            # el doctor sólo distingue por tipo; no hace falta una respuesta HTTP real
            e = anthropic.AuthenticationError.__new__(anthropic.AuthenticationError)
            Exception.__init__(e, "invalid x-api-key")
            raise e

    class _Cliente:
        def __init__(self, **kw):
            self.models = _Modelos()

    monkeypatch.setattr(anthropic, "Anthropic", _Cliente)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-" + "a" * 91 + "WXYZ")
    assert doctor.revisar_lectura() is False
    salida = capsys.readouterr().out
    assert "rechazó" in salida and "…WXYZ" in salida and "Vercel" in salida
    assert "a" * 20 not in salida                   # el secreto no se imprime


def test_las_llaves_se_leen_del_env_local(monkeypatch, tmp_path):
    import forge_agent
    for v in ("ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_KEY"):
        monkeypatch.delenv(v, raising=False)
    archivo = tmp_path / ".env.local"
    # el Bloc de notas guarda con BOM; y la plataforma ya tiene las VITE_
    archivo.write_text('﻿VITE_SUPABASE_URL=https://abc.supabase.co\n'
                       'VITE_SUPABASE_ANON_KEY=eyJ.anon\n'
                       '# comentario\n'
                       'ANTHROPIC_API_KEY = "sk-ant-api03-real"\n', encoding="utf-8")
    forge_agent.cargar_env_local(str(archivo))
    import os
    assert os.environ["ANTHROPIC_API_KEY"] == "sk-ant-api03-real"
    assert os.environ["SUPABASE_URL"] == "https://abc.supabase.co"
    assert os.environ["SUPABASE_KEY"] == "eyJ.anon"


def test_el_entorno_gana_salvo_que_sea_el_ejemplo(monkeypatch, tmp_path):
    import os

    import forge_agent
    archivo = tmp_path / ".env.local"
    archivo.write_text("ANTHROPIC_API_KEY=sk-ant-api03-del-archivo\n", encoding="utf-8")

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-del-entorno")
    forge_agent.cargar_env_local(str(archivo))
    assert os.environ["ANTHROPIC_API_KEY"] == "sk-ant-api03-del-entorno"

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-...")
    forge_agent.cargar_env_local(str(archivo))
    assert os.environ["ANTHROPIC_API_KEY"] == "sk-ant-api03-del-archivo"
