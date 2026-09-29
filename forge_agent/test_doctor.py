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
    assert doctor.revisar_lectura() is True
    assert "✓ lectura de fotos" in capsys.readouterr().out


def test_cada_falla_del_resumen_tiene_su_linea(monkeypatch, capsys):
    # sin llave ni Supabase: el cierre pide arreglar ✗, y debe haber al menos uno
    for v in ("ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_KEY", "FORGE_PROVEEDOR"):
        monkeypatch.delenv(v, raising=False)
    codigo = doctor.main()
    salida = capsys.readouterr().out
    if "Arregla las líneas con ✗" in salida:
        assert codigo == 1
        assert salida.count("✗") >= 2, salida
