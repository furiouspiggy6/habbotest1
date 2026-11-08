// Read-only spot ETH/AUD and ETH/USD conversion for an approximate WETH fiat minimum.
// No secrets, wallet or trading endpoints are used here.
const SPOT_URL='https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=aud%2Cusd';
export async function fetchFiatRates(fetcher=globalThis.fetch,now=Date.now()){
 if(typeof fetcher!=='function')throw new Error('Fiat price fetch unavailable');
 let response;
 try{
  response=await fetcher(SPOT_URL,{
   method:'GET',
   headers:{Accept:'application/json','User-Agent':'Habbo-NFT-Market-Radar'},
   signal:AbortSignal.timeout(9000)
  });
 }catch(e){throw new Error('CoinGecko ETH spot quote request failed: '+String(e?.message??e).slice(0,140));}
 if(!response.ok)throw new Error('CoinGecko ETH spot quote returned HTTP '+response.status);
 let body;
 try{body=await response.json();}catch{throw new Error('CoinGecko returned invalid spot price JSON');}
 const aud=Number(body?.ethereum?.aud),usd=Number(body?.ethereum?.usd);
 if(!Number.isFinite(aud)||!Number.isFinite(usd)||aud<=0||usd<=0||aud>1000000||usd>1000000)throw new Error('CoinGecko returned an invalid ETH/AUD or ETH/USD rate');
 return {aud,usd,fetchedAt:now,source:'CoinGecko ETH spot (approximate WETH)'};
}
