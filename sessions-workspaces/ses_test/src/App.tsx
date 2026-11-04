import React, { useState, useEffect } from 'react'

interface WeatherData {
  temperature: number
  windspeed: number
  weathercode: number
  time: string
}

interface QuoteData {
  quote: string
  author: string
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'weather' | 'crypto' | 'quotes'>('weather')
  const [city, setCity] = useState('Sao Paulo')
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [quote, setQuote] = useState<QuoteData | null>(null)
  const [cryptoPrices, setCryptoPrices] = useState<Record<string, { usd: number; usd_24h_change: number }> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch real Public Weather API (Open-Meteo)
  const fetchWeather = async () => {
    setLoading(true)
    setError(null)
    try {
      // Default to Sao Paulo coordinates (-23.55, -46.63)
      const res = await fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=-23.55&longitude=-46.63&current_weather=true'
      )
      if (!res.ok) throw new Error('Falha ao obter dados meteorológicos')
      const data = await res.json()
      if (data.current_weather) {
        setWeather({
          temperature: data.current_weather.temperature,
          windspeed: data.current_weather.windspeed,
          weathercode: data.current_weather.weathercode,
          time: data.current_weather.time,
        })
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar clima')
    } finally {
      setLoading(false)
    }
  }

  // Fetch real Public Quotes API
  const fetchQuote = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('https://dummyjson.com/quotes/random')
      if (!res.ok) throw new Error('Falha ao carregar citação')
      const data = await res.json()
      setQuote({ quote: data.quote, author: data.author })
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar citação')
    } finally {
      setLoading(false)
    }
  }

  // Fetch real Public Crypto Prices (CoinGecko)
  const fetchCrypto = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true'
      )
      if (!res.ok) throw new Error('Falha ao carregar cotações de cripto')
      const data = await res.json()
      setCryptoPrices(data)
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar cotações')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'weather') fetchWeather()
    if (activeTab === 'quotes') fetchQuote()
    if (activeTab === 'crypto') fetchCrypto()
  }, [activeTab])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center p-6 font-sans">
      <header className="max-w-2xl w-full text-center my-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold tracking-wide uppercase mb-3">
          React 19 + Vite Live Runtime
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-cyan-400 via-sky-300 to-indigo-400 bg-clip-text text-transparent">
          Web App em React + Vite com APIs Públicas
        </h1>
        <p className="text-slate-400 text-sm mt-2">
          Peça ao agente no chat para criar qualquer web app ou site em React+Vite com dados de APIs públicas.
        </p>
      </header>

      {/* Navigation Tabs */}
      <div className="flex bg-slate-900 p-1.5 rounded-xl border border-slate-800 gap-1.5 mb-6 max-w-md w-full">
        <button
          onClick={() => setActiveTab('weather')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${
            activeTab === 'weather'
              ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Clima (Open-Meteo)
        </button>
        <button
          onClick={() => setActiveTab('crypto')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${
            activeTab === 'crypto'
              ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Cripto (CoinGecko)
        </button>
        <button
          onClick={() => setActiveTab('quotes')}
          className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${
            activeTab === 'quotes'
              ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Inspiração (DummyJSON)
        </button>
      </div>

      {/* Main Content Area */}
      <main className="max-w-md w-full bg-slate-900/90 border border-slate-800/80 rounded-2xl p-6 shadow-2xl backdrop-blur">
        {loading && (
          <div className="py-12 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-slate-400 text-sm">Carregando dados da API pública...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-xl text-sm mb-4">
            <p className="font-semibold">Erro na chamada da API</p>
            <p className="text-xs mt-1 text-red-300">{error}</p>
            <button
              onClick={() => {
                if (activeTab === 'weather') fetchWeather()
                if (activeTab === 'crypto') fetchCrypto()
                if (activeTab === 'quotes') fetchQuote()
              }}
              className="mt-3 px-3 py-1 bg-red-600/80 hover:bg-red-600 text-white text-xs rounded-lg font-medium transition"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {!loading && !error && activeTab === 'weather' && weather && (
          <div className="flex flex-col gap-4 text-center">
            <span className="text-xs uppercase tracking-wider text-slate-400">Previsão em Tempo Real</span>
            <div className="text-6xl font-black text-cyan-400">{weather.temperature}°C</div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
                <span className="text-xs text-slate-400 block">Vento</span>
                <span className="text-lg font-bold text-slate-200">{weather.windspeed} km/h</span>
              </div>
              <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/50">
                <span className="text-xs text-slate-400 block">Condição</span>
                <span className="text-lg font-bold text-slate-200">
                  {weather.weathercode === 0 ? 'Céu Limpo' : 'Parcialmente Nublado'}
                </span>
              </div>
            </div>
            <button
              onClick={fetchWeather}
              className="mt-2 w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm rounded-xl font-medium transition"
            >
              Atualizar Clima
            </button>
          </div>
        )}

        {!loading && !error && activeTab === 'crypto' && cryptoPrices && (
          <div className="flex flex-col gap-3">
            <span className="text-xs uppercase tracking-wider text-slate-400 text-center mb-1">
              Mercado Cripto em Tempo Real
            </span>
            {Object.entries(cryptoPrices).map(([id, info]) => (
              <div
                key={id}
                className="flex items-center justify-between p-3.5 bg-slate-800/60 rounded-xl border border-slate-700/50"
              >
                <div>
                  <span className="font-bold text-slate-200 uppercase">{id}</span>
                  <span className="block text-xs text-slate-400">USD</span>
                </div>
                <div className="text-right">
                  <span className="font-bold text-slate-100 block">
                    ${info.usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      info.usd_24h_change >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {info.usd_24h_change >= 0 ? '+' : ''}
                    {info.usd_24h_change?.toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
            <button
              onClick={fetchCrypto}
              className="mt-2 w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm rounded-xl font-medium transition"
            >
              Atualizar Cotações
            </button>
          </div>
        )}

        {!loading && !error && activeTab === 'quotes' && quote && (
          <div className="flex flex-col gap-4 text-center">
            <span className="text-xs uppercase tracking-wider text-slate-400">Pensamento do Dia</span>
            <blockquote className="text-lg font-medium italic text-slate-200 leading-relaxed">
              "{quote.quote}"
            </blockquote>
            <span className="text-sm font-semibold text-cyan-400">— {quote.author}</span>
            <button
              onClick={fetchQuote}
              className="mt-3 w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm rounded-xl font-medium transition"
            >
              Nova Citação
            </button>
          </div>
        )}
      </main>

      <footer className="mt-8 text-xs text-slate-500 text-center">
        OpenCode Web • React + Vite Autonomous Runtime
      </footer>
    </div>
  )
}
