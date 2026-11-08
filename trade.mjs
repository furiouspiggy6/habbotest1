/** Live purchases are explicitly gated and use only a throwaway, locally-controlled wallet.
 * Requires ERC20 WETH, immutable native-gas IMX, a pre-existing limited token allowance,
 * and a second fresh listing check. Real SDK integration cannot be independently tested here.
 */
import {WETH,normalizeOrder} from './core.mjs';
import {makeClients} from './market.mjs';
const CONTRACTS=new Set();
export function setAllowedContracts(collections){CONTRACTS.clear();for(const c of collections)if(c.enabled)CONTRACTS.add(c.address.toLowerCase());}
const extractOrder=x=>x?.result?.result??x?.result??x;
export async function executeLiveBuy(candidate,settings,privateKey){
 if(!/^0x[a-fA-F0-9]{64}$/.test(privateKey||''))throw new Error('Dedicated wallet private key not configured.');
 if(!candidate?.eligible||candidate.quantity!==1||candidate.currency!=='WETH'||!CONTRACTS.has(candidate.contract))throw new Error('Candidate is not an approved ERC721/1155 ETH listing.');
 const {orderbook,pkg}=await makeClients(settings.publishableKey);
 const {Wallet,JsonRpcProvider,Contract,formatEther}=await import('ethers');
 const provider=new JsonRpcProvider('https://rpc.immutable.com',13371);
 const net=await provider.getNetwork();if(net.chainId!==13371n)throw new Error('Wrong blockchain.');
 const signer=new Wallet(privateKey,provider);
 const current=extractOrder(await orderbook.getListing(candidate.id));
 const col=settings.collections.find(c=>c.address.toLowerCase()===candidate.contract);
 const fresh=normalizeOrder(current,col,'ACTIVE');
 if(!fresh||fresh.contract!==candidate.contract||fresh.tokenId!==candidate.tokenId)throw new Error('Listing changed or disappeared.');
 if(fresh.quantity!==1||fresh.price>candidate.price||fresh.totalWithFeesEth>settings.maximumPriceEth)throw new Error('Price, quantity or fees increased.');
 if(fresh.price<settings.minPriceEth)throw new Error('Price below the minimum safety floor.');
 if(settings.minimumTotalPriceEth>0&&fresh.totalWithFeesEth<settings.minimumTotalPriceEth)throw new Error('Fresh order is below the configured AUD minimum, including buyer fees.');
 const checkProfit=cost=>{
  const ref=Number(candidate.reference),qty=Number(candidate.quantity);
  const fee=Number(settings.estimatedResaleFeesPct);
  if(!Number.isFinite(ref)||ref<=0||!Number.isFinite(qty)||qty!==1||!Number.isFinite(fee))
   throw new Error('Reference price or resale fee is not verifiable.');
  const estimatedProfit=ref*qty*(1-fee/100)-cost;
  if(!Number.isFinite(estimatedProfit)||estimatedProfit+1e-12<Number(settings.minimumProfitEth??0))
   throw new Error('Updated order falls below the minimum estimated AUD profit.');
 };
 checkProfit(fresh.totalWithFeesEth);
 // ERC20 approval is intentionally NEVER auto signed (could be unlimited).
 const token=new Contract(WETH,['function balanceOf(address) view returns (uint256)'],provider);
 const balance=await token.balanceOf(signer.address);
 if(Number(formatEther(balance))<fresh.totalWithFeesEth)throw new Error('Not enough WETH.');
 const gasBalance=await provider.getBalance(signer.address);if(gasBalance<1000000000000000n)throw new Error('Not enough native IMX reserved for gas.');
 const prepared=await orderbook.fulfillOrder(candidate.id,signer.address,[]);
 const checked=normalizeOrder(extractOrder(prepared.order??current),col,'ACTIVE');
 if(!checked||checked.id!==candidate.id||checked.contract!==candidate.contract||checked.tokenId!==candidate.tokenId)throw new Error('Settlement details could not be independently verified; aborting.');
 if(checked.price>candidate.price||checked.totalWithFeesEth>settings.maximumPriceEth)throw new Error('Settlement fees changed; aborting.');
 if(settings.minimumTotalPriceEth>0&&checked.totalWithFeesEth<settings.minimumTotalPriceEth)throw new Error('Settlement is below the configured AUD minimum.');
 checkProfit(checked.totalWithFeesEth);
 const actions=prepared.actions||[];
 if(actions.length!==1||actions[0].type!==pkg.orderbook.ActionType.TRANSACTION)throw new Error('An allowance approval or unexpected extra action is required. Approve a limited WETH amount manually before retrying.');
 const tx=await actions[0].buildTransaction();
 if(!/^0x[a-fA-F0-9]{40}$/.test(String(tx?.to??''))||!/^0x[a-fA-F0-9]+$/.test(String(tx?.data??'')))throw new Error('Malformed settlement transaction.');
 if(BigInt(tx.value||0)>0n)throw new Error('Refusing unexpected native-token transfer.');
 const gas=await signer.estimateGas(tx);
 const fee=await provider.getFeeData();
 const gasPrice=fee.maxFeePerGas??fee.gasPrice??0n;
 if(!gasPrice||gas*gasPrice>100000000000000000n)throw new Error('Gas cost excessive or unknown.');
 const sent=await signer.sendTransaction({...tx,gasLimit:gas*125n/100n});
 const receipt=await sent.wait(1);
 if(receipt?.status!==1)throw new Error(`Transaction ${sent.hash} did not succeed.`);
 return {hash:sent.hash,priceEth:fresh.totalWithFeesEth,wallet:signer.address};
}
