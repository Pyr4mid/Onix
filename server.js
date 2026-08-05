const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

const TOR_PROXY = 'socks5://127.0.0.1:9050';
const agent = new SocksProxyAgent(TOR_PROXY);

// ========== محركات البحث ==========
const ENGINES = [
    {
        name: 'Ahmia',
        buildUrl: (term) => `http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion/search/?q=${encodeURIComponent(term)}`
    },
    {
        name: 'Torch',
        buildUrl: (term) => `http://xmh57jrknzkhv6y3ls3ubitzfqnkrwxhopf5aygthi7d6rplyvk3noyd.onion/cgi-bin/omega/omega?P=${encodeURIComponent(term)}`
    },
    {
        name: 'Onix',
        buildUrl: (term) => `https://onionengine.io/scrape.php?q=${encodeURIComponent(term)}&page=1`
    }
];

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// ========== فحص Tor ==========
async function checkTorConnection() {
    try {
        const response = await axios.get('https://check.torproject.org/', {
            httpAgent: agent,
            httpsAgent: agent,
            timeout: 15000
        });
        if (response.data.includes('Congratulations')) {
            return { connected: true, message: '✅ Tor متصل ويعمل بشكل صحيح' };
        }
        return { connected: true, message: '⚠️ Tor متصل ولكن قد يكون هناك تأخير' };
    } catch (error) {
        return { connected: false, message: '❌ Tor غير متصل', detail: error.message };
    }
}

function extractOnionLinks(html) {
    const regex = /\b[a-z2-7]{16,56}\.onion\b/gi;
    const matches = html.match(regex) || [];
    return [...new Set(matches)];
}

async function fetchFromEngine(engine, term) {
    try {
        const url = engine.buildUrl(term);
        const response = await axios.get(url, {
            httpAgent: agent,
            httpsAgent: agent,
            timeout: 45000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const links = extractOnionLinks(response.data);
        console.log(`   [OK] ${engine.name} — found ${links.length} links`);
        return links;
    } catch (error) {
        console.log(`   [ERR] ${engine.name} — ${error.message}`);
        return [];
    }
}

async function validateLink(onionUrl) {
    try {
        const response = await axios.get(`http://${onionUrl}`, {
            httpAgent: agent,
            httpsAgent: agent,
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (response.status === 200 || response.status === 403 || response.status === 429) {
            const $ = cheerio.load(response.data);
            const title = $('title').text().trim() || 'Untitled';
            return {
                url: `http://${onionUrl}`,
                title: title.slice(0, 120),
                status: response.status,
                valid: true
            };
        }
        return null;
    } catch (error) {
        return null;
    }
}

async function performSearch(query) {
    console.log(`\n[🔍] Onix — بحث عن: ${query}`);
    
    console.log('[🔎] جلب الروابط من المحركات...');
    const linkPromises = ENGINES.map(engine => fetchFromEngine(engine, query));
    const results = await Promise.all(linkPromises);
    const allLinks = [...new Set(results.flat())];
    console.log(`[📊] تم العثور على ${allLinks.length} رابط فريد`);
    
    if (allLinks.length === 0) {
        return { links: [], message: 'لا توجد نتائج' };
    }
    
    console.log('[✅] التحقق من الروابط...');
    const limitedLinks = allLinks.slice(0, 35);
    const validationPromises = limitedLinks.map(link => validateLink(link));
    const validated = await Promise.all(validationPromises);
    const validLinks = validated.filter(link => link !== null);
    console.log(`[📦] تم التحقق من ${validLinks.length} رابط صالح`);
    
    return {
        query: query,
        total_found: allLinks.length,
        total_valid: validLinks.length,
        links: validLinks
    };
}

// ========== Routes ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/check-tor', async (req, res) => {
    const result = await checkTorConnection();
    res.json(result);
});

app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query || query.length < 2) {
        return res.status(400).json({ error: 'استعلام قصير جداً' });
    }
    
    const torCheck = await checkTorConnection();
    if (!torCheck.connected) {
        return res.status(503).json({
            error: 'TOR_NOT_CONNECTED',
            message: '⚠️ يجب تشغيل تطبيق Orbot أولاً!',
            details: torCheck.detail || 'Tor غير متصل',
            retry: true
        });
    }
    
    try {
        const result = await performSearch(query);
        res.json(result);
    } catch (error) {
        console.error('[CRIT] Search failed:', error);
        res.status(500).json({ error: 'فشل البحث', details: error.message });
    }
});

app.get('/health', async (req, res) => {
    const torCheck = await checkTorConnection();
    res.json({
        status: 'online',
        app: 'Onix',
        tor: torCheck.connected,
        tor_message: torCheck.message,
        engines: ENGINES.map(e => e.name)
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔══════════════════════════════════════════════╗
    ║   🧅 Onix — Dark Web Search Engine          ║
    ║   يعمل عبر Tor (يلزم تشغيل Orbot)           ║
    ║   http://localhost:${PORT}                   ║
    ║   المحركات: ${ENGINES.map(e => e.name).join(' + ')}  ║
    ╚══════════════════════════════════════════════╝
    `);
    
    checkTorConnection().then(result => {
        if (result.connected) {
            console.log(`[✅] ${result.message}`);
        } else {
            console.log(`[⚠️] ${result.message}`);
            console.log('[⚠️] يرجى تشغيل Orbot قبل بدء البحث');
        }
    });
});