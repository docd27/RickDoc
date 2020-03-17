const fetch = require('node-fetch').default;
const util = require('util');
const path = require('path');
const cheerio = require('cheerio');
const {version: packageVersion} = require('../package.json');
const express = require('express');
const typeis = require('type-is');
const expressHandlebars  = require('express-handlebars');
require('dotenv').config({ path: path.join(__dirname, '..', '.env')});

const json2 = (obj, depth=6) => {
  console.log(util.inspect(obj, {depth: depth, colors: true, compact: 3}));
};

const app = express();
app.set('views', path.join(__dirname, '..', 'views'));
const port = Number.parseInt(process.env.PORT, 10);
const cloneBaseURL = process.env.CLONE_URL;

const fullURL = (req, path) => {
  const url = new URL(path, 'http://localhost');
  url.protocol = req.protocol;
  url.hostname = req.hostname;
  url.port = `${port}`;
  return url.toString();
};

const relToAbsoluteURL = (url, base) => {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

const rewriteCSS = (styleHTML, base) => {
  return styleHTML.replace(/url\s*\((?:([^\)']*)|\s*'([^']*)'\s*)\)/g, function(match, g1, g2, offset, input_string)
  {
    return `url('${relToAbsoluteURL(g1 === undefined ? g2 : g1, base)}')`;
  });
}

async function mdnRequest(headers, url) {
  // const url = new URL(path, 'http://httpbin.org/');
  const response = await fetch(url, {
    method: 'GET',
    // cache: 'reload',
    headers: {
      'Accept': headers.accept ? headers.accept : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': headers['accept-language'] ? headers['accept-language'] : 'en-US',
      'DNT': '1',
      'User-Agent': headers['user-agent'] ? headers['user-agent'] : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:74.0) Gecko/20100101 Firefox/74.0',
    },
  });
  return response;
}

const logReq = (req, msg) => {
  console.log(`${(new Date()).toISOString()} ${req.ip}: ${msg}`);
};

app.engine('handlebars', expressHandlebars());
app.set('view engine', 'handlebars');

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY_IPS);

app.use((req, res, next) => {
  res.set('Cache-Control', 'public, max-age=86400'); // Cache 24 hours
  // @ts-ignore
  req.custReqURL = fullURL(req, req.originalUrl);
  // @ts-ignore
  req.custBaseURL = fullURL(req, req.baseUrl.replace(/\/+$/, ''));
  logReq(req, `${req.method} ${req.originalUrl}`);
  next();
});

app.use((err, req, res, next) => { // Error handler
  logReq(req, 'ERROR');
  console.error(err.stack)
  res.status(500).send('Internal Server Error');
});

//app.use('/static', express.static(path.join(__dirname, '..', 'static')));

app.get('/robots.txt', (req, res, next) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /\n');
});

// Favicon breaks on firefox with more than one redirect, and mdn favicon.ico is itself a redirect
app.get('/favicon.ico', (req, res, next) => res.redirect(`${cloneBaseURL}/static/img/favicon32.7f3da72dcea1.png`));

app.get('*', async (req, res, next) => {
  const cloneURL = relToAbsoluteURL(req.originalUrl, cloneBaseURL);

  logReq(req, `FETCH ${cloneURL}`);
  const mdnResult = await mdnRequest(req.headers, cloneURL);
  res.statusCode = mdnResult.status;
  res.statusMessage = mdnResult.statusText;

  if (!mdnResult.headers.has('content-type') ||
      !typeis.is(mdnResult.headers.get('content-type'), 'text/html')) {
    logReq(req, `REDIRECT ${mdnResult.headers.get('content-type')} TO ${req.originalUrl}`);
    // Request to a non-html resource got through, redirect
    res.redirect(cloneURL);
    return;
  }
  const mdnHTML = await mdnResult.text();
  const $doc = cheerio.load(mdnHTML);

  const metaVals = new Map();
  $doc('meta', 'head').each((i, e) =>
  {
    if (e.attribs['name']) {
      metaVals.set(e.attribs['name'], e.attribs['content']);
    } else if (e.attribs['property']) {
      metaVals.set(e.attribs['property'], e.attribs['content']);
    }
  });
  const pageTitle = $doc('title', 'head').text();

  const headerLines = [];
  // headerLines.push(`<base href="${cloneBaseURL}">`);
  $doc('link', 'head').each((i, e) =>
  {
    if (e.attribs['href']) {
      e.attribs['href'] = relToAbsoluteURL(e.attribs['href'], cloneBaseURL);
      headerLines.push($doc.html(e));
    }
  });
  $doc('style', 'head').each((i, e) =>
  {
    const styleHTML = $doc.html(e);
    headerLines.push(rewriteCSS(styleHTML, cloneBaseURL));
  });
  res.locals.pageInfo = {
    baseCloneURL: cloneBaseURL,
    // @ts-ignore
    baseURL: req.custBaseURL,
    // @ts-ignore
    pageURL: req.custReqURL,
    pageTitle,
    metaTitle: metaVals.get('og:title'),
    metaDescription: metaVals.get('og:description'),
  }
  res.locals.cloneURL = cloneURL;

  res.locals.headers = headerLines.join('\n');

  $doc('script', 'body').remove();
  res.locals.bodyContent = $doc('body').html();
  res.render('container');
});

app.all('*', (req, res, next) => { // POST etc
  logReq(req, `${req.method} ${req.originalUrl} 404 Not Found`);
  res.status(404).send('Not Found');
});

app.listen(port, 'localhost', () => console.log(`App listening on port ${port}!`))