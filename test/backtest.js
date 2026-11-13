const E=require('../engine.js');
let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647};
const norm=()=>Math.sqrt(-2*Math.log(rnd()))*Math.cos(2*Math.PI*rnd());
function run(name,mu,sigma,users=300){
  let nE=0,mae=0,mae28=0,maeMean=0,cov=0,wid=0;
  for(let u=0;u<users;u++){
    const lens=[];for(let i=0;i<14;i++)lens.push(Math.max(18,Math.min(90,Math.round(mu+sigma*norm()))));
    let d='2025-01-01';const periods=[{start:d}];for(const l of lens){d=E.add(d,l);periods.push({start:d});}
    for(let k=7;k<periods.length;k++){
      const hist=periods.slice(0,k),actual=E.diff(periods[k].start,periods[k-1].start);
      const st={periods:hist,days:{},settings:{mode:'auto',predictionsOn:true}};
      const p=E.predictNext(st,E.add(hist.at(-1).start,0));
      const likely=E.diff(p.nextStart.likely,hist.at(-1).start);
      const hl=E.validLens(hist);
      mae+=Math.abs(likely-actual);mae28+=Math.abs(28-actual);maeMean+=Math.abs(Math.round(E.mean(hl))-actual);
      cov+=(actual>=E.diff(p.nextStart.earliest,hist.at(-1).start)&&actual<=E.diff(p.nextStart.latest,hist.at(-1).start))?1:0;
      wid+=p.windowDays;nE++;
    }
  }
  console.log(`${name.padEnd(22)} MAE cyclewise ${(mae/nE).toFixed(1)}d | simple mean ${(maeMean/nE).toFixed(1)}d | fixed-28 ${(mae28/nE).toFixed(1)}d | window covers ${(100*cov/nE).toFixed(0)}% (avg ${(wid/nE).toFixed(1)}d wide)`);
}
run('Regular σ=1.5',29,1.5);run('Variable σ=3',30,3);run('Irregular σ=8',38,8);run('Very irregular σ=14',45,14);
