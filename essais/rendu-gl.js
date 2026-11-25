/* PoolCast — moteur de rendu sur carte graphique (WebGL2).

   Se charge APRÈS le script principal et remplace `startRender` : le même
   lancer de rayons (caméra, bassin, fond relevé, escaliers, projecteurs) mais
   calculé pixel par pixel sur le GPU, des centaines de fois plus vite. Ce gain
   paie ce que le moteur d'origine ne pouvait pas s'offrir :

     - reflets de la VRAIE photo dans l'eau (maison, haies, ciel), déformés par
       les rides, et de la paroi émergée au ras des bords ;
     - ombres du soleil portées par les bords sur l'eau, les parois et le fond,
       avec pénombre qui s'élargit avec la distance ;
     - caustiques réalistes, projetées le long du rayon solaire réfracté et
       légèrement irisées en profondeur ;
     - occlusion ambiante dans les angles fond/paroi ;
     - pierre « rustique bullée » avec vraies bulles, joints et nez arrondi ;
     - accord automatique sur la photo : point noir, dominante, grain ;
     - suréchantillonnage de TOUS les pixels (bords nets, sans escalier).

   Sans WebGL2 (ou si le shader échoue), rien n'est remplacé : l'outil garde
   son moteur d'origine. `?rendu=cpu` dans l'adresse force aussi l'ancien. */
(() => {
"use strict";
if (typeof startRender !== 'function' || /[?&]rendu=cpu\b/.test(location.search)) return;

/* ---------- coloris de coque Aboral ----------
   Aboral ne propose plus qu'un seul gris, le Quartz (RAL 7040), un peu plus
   foncé que le Papyrus. Valeurs sRGB approchées des teintes RAL. */
const ABORAL = [
  {n:'Blanc Pur (RAL 9000)', c:[238,239,235]},
  {n:'Ivoire (RAL 1013)',    c:[226,216,196]},
  {n:'Papyrus (RAL 7035)',   c:[200,205,201]},
  {n:'Quartz, gris (RAL 7040)', c:[150,156,159]},
  {n:'Bleu Azur',            c:[ 86,146,198]},
];
try {
  LINERS.splice(0, LINERS.length, ...ABORAL);
  const sel = $('lin');
  sel.innerHTML = '';
  ABORAL.forEach((l,i) => sel.appendChild(new Option(l.n, String(i))));
  sel.value = '3';
} catch(e) { console.warn('[rendu GPU] coloris non mis à jour', e); }

const glc = document.createElement('canvas');
const gl = glc.getContext('webgl2', {alpha:true, premultipliedAlpha:true, antialias:false,
                                     preserveDrawingBuffer:true, powerPreference:'high-performance'});
if (!gl) { console.warn('[rendu GPU] WebGL2 indisponible : moteur d\'origine conservé'); return; }

const VS = `#version 300 es
in vec2 aPos; void main(){ gl_Position = vec4(aPos,0.,1.); }`;

const FS = `#version 300 es
precision highp float;
precision highp int;
out vec4 outColor;

uniform vec2 uRes;
uniform float uF; uniform vec2 uO; uniform mat3 uR; uniform vec3 uT; uniform vec3 uC;
uniform float uDn, uZw, uZwat, uWl;
uniform float uL, uW; uniform int uShape; uniform float uRoundR;
uniform float uCopW; uniform vec3 uCop, uCopJ; uniform int uCopTex;
uniform vec3 uLiner; uniform int uFrz;
uniform float uWav, uRefl, uShd, uShK, uExpo, uSunLit;
uniform vec3 uSunDir; uniform vec2 uShadowDir;
uniform vec3 uSkyTop, uSkyHor;
uniform sampler2D uPhoto; uniform float uPhotoLod;
uniform sampler2D uGrid; uniform int uHasGrid; uniform ivec2 uGridN; uniform float uGridCell;
uniform int uFond; uniform float uPs, uPd;
uniform int uStN; uniform vec4 uStA[3]; uniform vec4 uStB[3]; uniform vec4 uStC[3];
uniform int uLampN; uniform vec3 uLampPos[4]; uniform vec3 uLampCol; uniform float uLampI, uLampGain;
uniform vec3 uTint; uniform float uLift, uGrain;
uniform int uSS;
uniform float uTime;

const vec3 ABS  = vec3(0.46, 0.105, 0.055);
const vec3 SCAT = vec3(26., 104., 116.);
const float SLAB = 0.50;

/* ---------- bruits ---------- */
float hash2(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash2(i),hash2(i+vec2(1,0)),u.x), mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.3); a*=.5; } return s; }
// distance normalisée au centre de la bulle la plus proche (< 1 : dans une bulle)
float cell(vec2 p){ vec2 i=floor(p), f=fract(p); float d=9.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g=vec2(x,y); vec2 o=vec2(hash2(i+g), hash2(i+g+19.7));
    float r=.16+.30*hash2(i+g+5.3);
    d=min(d, length(g+o-f)/r);
  }
  return d; }

/* ---------- caméra ---------- */
vec3 rayDir(vec2 f){ vec2 d=(f-uO)/uF; return normalize(uR*vec3(d,1.)); }
bool hitPlane(vec3 D, float Z, out vec3 h){
  if(abs(D.z)<1e-9) return false;
  float t=(Z-uC.z)/D.z; if(t<=0.) return false;
  h=vec3(uC.xy+D.xy*t, t); return true; }
vec3 proj(vec3 P){ vec3 c=transpose(uR)*P+uT; if(c.z<=1e-6) return vec3(0.,0.,-1.);
  return vec3(uO+uF*c.xy/c.z, c.z); }

/* ---------- bassin ---------- */
float sdPool(vec2 p){
  float hx=uL*.5, hy=uW*.5; vec2 q=abs(p-vec2(hx,hy));
  if(uShape==2){ return (length(q/vec2(hx,hy))-1.)*min(hx,hy); }
  float r = uShape==1 ? min(hx,hy)*uRoundR : 0.;
  vec2 d=q-vec2(hx-r,hy-r);
  return min(max(d.x,d.y),0.)+length(max(d,0.))-r; }
vec2 sdGrad(vec2 p){ float e=.01, s=sdPool(p);
  vec2 g=vec2(sdPool(p+vec2(e,0.))-s, sdPool(p+vec2(0.,e))-s)/e;
  float l=length(g); return l>1e-6 ? g/l : vec2(1.,0.); }

float depthAt(vec2 X){
  X=clamp(X, vec2(0.), vec2(uL,uW));
  if(uHasGrid==1){ ivec2 ij=clamp(ivec2(floor(X/uGridCell)), ivec2(0), uGridN-1); return texelFetch(uGrid, ij, 0).r; }
  float t=clamp(X.x/uL,0.,1.);
  if(uFond==0) return uPs;
  if(uFond==1) return mix(uPs,uPd,t);
  if(uFond==2){ if(t<.6) return uPs; return mix(uPs,uPd,smoothstep(0.,1.,clamp((t-.6)/.22,0.,1.))); }
  return mix(uPs,uPd,smoothstep(0.,1.,clamp((t-.35)/.45,0.,1.))); }

/* ---------- escalier (même description que le moteur d'origine) ---------- */
struct Part{ int side; float SL; int n; float run; float rise; float w; bool radial; float uc; bool corner; float reach; };
Part getPart(int i){ Part p;
  p.side=int(uStA[i].x+.5); p.SL=uStA[i].y; p.n=int(uStA[i].z+.5); p.run=uStA[i].w;
  p.rise=uStB[i].x; p.w=uStB[i].y; p.radial=uStB[i].z>.5; p.uc=uStB[i].w;
  p.corner=uStC[i].x>.5; p.reach=uStC[i].y; return p; }
vec2 toLoc(Part p, vec2 X){ if(p.side==0) return X; if(p.side==1) return vec2(X.y,uL-X.x); if(p.side==2) return vec2(uL-X.x,uW-X.y); return vec2(uW-X.y,X.x); }
vec2 dirLoc(Part p, vec2 d){ if(p.side==0) return d; if(p.side==1) return vec2(d.y,-d.x); if(p.side==2) return -d; return vec2(-d.y,d.x); }
vec2 locToWorld(Part p, vec2 uv){ if(p.side==0) return uv; if(p.side==1) return vec2(uL-uv.y,uv.x); if(p.side==2) return vec2(uL-uv.x,uW-uv.y); return vec2(uv.y,uW-uv.x); }
vec2 normToWorld(Part p, vec2 n){ if(p.side==0) return n; if(p.side==1) return vec2(-n.y,n.x); if(p.side==2) return -n; return vec2(n.y,-n.x); }
bool inStair(Part p, float u, float v){
  if(v<0.||v>p.reach+1e-6) return false;
  if(p.radial){
    if(length(vec2(u-p.uc,v))>p.reach+1e-6) return false;
    if(p.corner && ((u<-1e-6 && p.uc<=0.) || (u>p.SL+1e-6 && p.uc>=p.SL))) return false;
  } else if(abs(u-p.uc)>p.w*.5+1e-6) return false;
  if(uShape!=0 && sdPool(locToWorld(p,vec2(u,v)))>=0.) return false;
  return true; }
float stairDepth(Part p, float u, float v){
  if(!inStair(p,u,v)) return -1.;
  float m=p.radial?length(vec2(u-p.uc,v)):v;
  return (min(float(p.n-1), floor(m/p.run))+1.)*p.rise; }
void keepHit(Part p, float t, float dep, vec3 nl, inout float bt, inout float bd, inout vec3 bn){
  if(t<=1e-6 || t>=bt) return;
  bt=t; bd=dep; bn=vec3(normToWorld(p,nl.xy), nl.z); }
void partHit(Part p, vec2 O, vec3 T, float td, float floorD, inout float bt, inout float bd, inout vec3 bn){
  vec2 lo=toLoc(p,O), dd=dirLoc(p,T.xy);
  float uo=lo.x, vo=lo.y, du=dd.x, dv=dd.y;
  for(int k=0;k<8;k++){                                   // girons
    if(k>=p.n) break;
    float dep=float(k+1)*p.rise; if(dep>floorD+1e-6) break;
    float t=dep/td, u=uo+du*t, v=vo+dv*t;
    if(!inStair(p,u,v)) continue;
    float m=p.radial?length(vec2(u-p.uc,v)):v;
    if(m<float(k)*p.run-1e-6 || m>float(k+1)*p.run+1e-6) continue;
    keepHit(p,t,dep,vec3(0.,0.,-1.),bt,bd,bn);
  }
  for(int k=0;k<8;k++){                                   // contremarches
    if(k>=p.n) break;
    float m=float(k+1)*p.run, dTop=float(k+1)*p.rise;
    float dBot = k==p.n-1 ? floorD : min(float(k+2)*p.rise, floorD);
    if(dBot<=dTop) continue;
    if(p.radial){
      float ou=uo-p.uc, a=du*du+dv*dv; if(a<1e-12) continue;
      float b=2.*(ou*du+vo*dv), cc=ou*ou+vo*vo-m*m, disc=b*b-4.*a*cc;
      if(disc<0.) continue;
      float sq=sqrt(disc);
      for(int r=0;r<2;r++){
        float t=(-b+(r==0?-sq:sq))/(2.*a); if(t<=1e-6) continue;
        float dep=td*t; if(dep<dTop-1e-6||dep>dBot+1e-6) continue;
        float u=uo+du*t, v=vo+dv*t; if(v<-1e-6) continue;
        if(!inStair(p,u,max(v,0.))) continue;
        keepHit(p,t,dep,vec3((u-p.uc)/m, v/m, 0.),bt,bd,bn);
      }
    } else {
      if(abs(dv)<1e-12) continue;
      float t=(m-vo)/dv; if(t<=1e-6) continue;
      float dep=td*t; if(dep<dTop-1e-6||dep>dBot+1e-6) continue;
      if(abs(uo+du*t-p.uc)>p.w*.5+1e-6) continue;
      keepHit(p,t,dep,vec3(0.,1.,0.),bt,bd,bn);
    }
  }
  if(!p.radial && abs(du)>1e-12){                         // joues
    for(int sg=0;sg<2;sg++){
      float sgn=sg==0?-1.:1.;
      float uu=p.uc+sgn*p.w*.5, t=(uu-uo)/du; if(t<=1e-6) continue;
      float dep=td*t, v=vo+dv*t;
      if(v<-1e-6||v>p.reach+1e-6) continue;
      float dT=stairDepth(p,uu,v);
      if(dT<0.||dep<dT-1e-6||dep>floorD+1e-6) continue;
      keepHit(p,t,dep,vec3(sgn,0.,0.),bt,bd,bn);
    }
  }
}

/* ---------- surface de l'eau ---------- */
const vec4 WV[6] = vec4[6](vec4(3.10,1.73,1.00,0.00), vec4(-2.21,4.07,.72,1.31), vec4(6.53,-3.19,.44,2.74),
                           vec4(-5.11,-7.23,.30,.62), vec4(11.70,8.41,.17,3.95), vec4(-14.3,6.11,.11,5.18));
vec3 surf(vec2 X, float amp){
  if(amp<=0.) return vec3(0.);
  float gx=0.,gy=0.,lap=0.,lapn=0.;
  for(int i=0;i<6;i++){
    vec4 w=WV[i]; float ph=w.x*X.x+w.y*X.y+w.w+uTime*(.7+.13*float(i));
    float co=cos(ph), si=sin(ph);
    gx+=w.z*w.x*co; gy+=w.z*w.y*co;
    if(i<4){ float k=w.z*(w.x*w.x+w.y*w.y); lap-=k*si; lapn+=k; }
  }
  return vec3(gx*amp, gy*amp, lap/lapn); }
// micro-rides : ce sont elles qui cassent le reflet en paillettes
vec2 micro(vec2 X){
  float e=.006;
  float n0=vnoise(X*9.)+.5*vnoise(X*23.+7.);
  float nx=vnoise((X+vec2(e,0.))*9.)+.5*vnoise((X+vec2(e,0.))*23.+7.);
  float ny=vnoise((X+vec2(0.,e))*9.)+.5*vnoise((X+vec2(0.,e))*23.+7.);
  return vec2(nx-n0, ny-n0)/e; }

// caustiques : réseau de lignes vives, périodique de pas 1 en uv
float caustic(vec2 uv){
  vec2 p=mod(uv*6.2831853, 6.2831853)-250.;
  vec2 i=p; float c=1.; const float inten=.005;
  float t=uTime*.45+23.;
  for(int n=0;n<5;n++){
    float tt=t*(1.-(3.5/float(n+1)));
    i=p+vec2(cos(tt-i.x)+sin(tt+i.y), sin(tt-i.y)+cos(tt+i.x));
    c+=1./length(vec2(p.x/(sin(i.x+tt)/inten), p.y/(cos(i.y+tt)/inten)));
  }
  c/=5.; c=1.17-pow(c,1.4);
  return clamp(pow(abs(c),8.),0.,2.); }

/* ---------- soleil ---------- */
vec3 sunWater(){ return refract(uSunDir, vec3(0.,0.,-uDn), 1./1.333); }
// part de soleil reçue par un point immergé (profondeur dep sous la ligne d'eau).
// Q1 : point où le rayon solaire a traversé la surface, tr : trajet total.
float sunVis(vec2 P, float dep, out vec2 Q1, out float tr){
  vec3 D=vec3(0.,0.,uDn), sw=sunWater();
  float t1=dep/max(dot(sw,D),.05);
  Q1=P-sw.xy*t1;
  float t2=uWl/max(dot(uSunDir,D),.05);
  vec2 Q2=Q1-uSunDir.xy*t2;
  tr=t1+t2;
  float pen=.012+.035*tr;
  float v=1.-smoothstep(-pen,pen,max(sdPool(Q1),sdPool(Q2)));
  return mix(1.,v,uShK); }

/* ---------- matériaux ---------- */
vec3 frieze(vec2 P, float z){
  vec3 f = uFrz==1 ? mix(uLiner,vec3(255.),.45) : vec3(38.,96.,168.);
  vec2 uv=vec2(P.x+P.y, z)*40.;
  vec2 q=fract(uv);
  float gr=smoothstep(0.,.09,min(min(q.x,1.-q.x),min(q.y,1.-q.y)));
  return f*(.9+.2*hash2(floor(uv)))*mix(.78,1.,gr); }

vec3 lampLight(vec2 P, float dep, vec3 Nl, float back){
  vec3 o=vec3(0.);
  for(int i=0;i<4;i++){
    if(i>=uLampN) break;
    vec3 d=uLampPos[i]-vec3(P,dep); float d2=dot(d,d), dd=sqrt(d2);
    if(dd<1e-3) continue;
    float fall=uLampI*2.4/(.45+d2);
    float k=.28+.72*max(0.,dot(Nl,d)/dd);
    o+=uLampCol/255.*fall*k*exp(-ABS*(dd+back));
  }
  return o; }
vec3 lampGlow(vec2 X, vec3 T, float td, float path){
  vec3 m=vec3(X+T.xy*path*.5, td*path*.5), o=vec3(0.);
  for(int i=0;i<4;i++){
    if(i>=uLampN) break;
    vec3 d=uLampPos[i]-m; float d2=dot(d,d), dd=sqrt(d2);
    o+=uLampCol/255.*(uLampI*path*.36/(.5+d2))*exp(-ABS*dd)*SCAT*.014;
  }
  return o; }

// paroi émergée entre margelle et ligne d'eau
vec3 dryWall(vec2 P, float above){
  float t=clamp(above/max(uWl,1e-4),0.,1.);
  vec3 c = uFrz>0 ? frieze(P,-above) : uLiner*1.06;
  float nose=1.-.36*smoothstep(0.,1.,clamp((t-.45)/.55,0.,1.));
  vec2 g=sdGrad(P); vec3 nW=vec3(-g,0.);
  float tUp=(uWl-above)/max(dot(uSunDir,vec3(0.,0.,uDn)),.05);
  float pen=.008+.03*tUp;
  float v=mix(1., 1.-smoothstep(-pen,pen,sdPool(P-uSunDir.xy*tUp+nW.xy*.004)), uShK);
  float ndl=max(dot(nW,-uSunDir),0.);
  c*=nose*(vec3(.6)+uSunLit*.6*v*ndl);
  if(uLampN>0){
    vec3 lit=lampLight(P,-above*.5,vec3(-g,0.),0.);
    c+=uLiner*lit*.5*(1.-t)*uLampGain;
  }
  return c; }

void edgeCoord(vec2 X, out float es, out float mitre, out float side){
  if(uShape!=0){ es=(atan(X.y-uW*.5, X.x-uL*.5)+3.14159265)*min(uL,uW)*.5; mitre=1e9; side=0.; return; }
  float d[4]=float[4](-X.y, X.x-uL, X.y-uW, -X.x);        // bas, droite, haut, gauche
  int i0=0; for(int i=1;i<4;i++) if(d[i]>d[i0]) i0=i;
  int i1=i0==0?1:0; for(int i=0;i<4;i++) if(i!=i0 && d[i]>d[i1]) i1=i;
  float base = i0==0?0. : i0==1?uL : i0==2?uL+uW : 2.*uL+uW;
  float along = i0==0?X.x : i0==1?X.y : i0==2?uL-X.x : uW-X.y;
  es=base+along; side=float(i0);
  mitre = d[i1]>0. ? abs(d[i0]-d[i1]) : 1e9; }

vec3 coping(vec2 X, float s){
  float t=clamp(s/uCopW,0.,1.);
  vec3 c=uCop;
  float n=(fbm(X*7.)-.5)*15.+(vnoise(X*150.)-.5)*8.;
  vec2 bump=vec2(vnoise(X*70.+3.)-.5, vnoise(X*70.+11.)-.5)*.22;
  if(uCopTex==1){
    // rustique bullée : alvéoles franches de 3 à 12 mm, ombrées sur le bord opposé au soleil
    float b=cell(X*48.), b2=cell(X*120.+7.3);
    float pit=1.-smoothstep(.62,1.,b), pit2=1.-smoothstep(.55,1.,b2);
    n-=pit*24.+pit2*11.;
    vec2 e=vec2(.002,0.);
    vec2 gb=vec2(cell((X+e.xy)*48.)-b, cell((X+e.yx)*48.)-b)/e.x;
    bump+=gb*.0045*pit;
  }
  c+=vec3(n,n,n*.92);
  float es, mitre, side; edgeCoord(X,es,mitre,side);
  float slab=floor(es/SLAB);
  float sv=(hash2(vec2(slab*7.77+side*131.3, side*17.1))-.5)*14.;
  c+=vec3(sv,sv*.97,sv*.9);
  float fr=fract(es/SLAB), dJ=min(fr,1.-fr)*SLAB;
  float dEdge=min(dJ, mitre*.5);
  const float J=.007;
  if(dEdge<J){ float m=1.-dEdge/J; c=mix(c,uCopJ,m); c*=1.-.18*m; }
  vec3 U=vec3(0.,0.,-uDn);
  vec3 N=normalize(U+vec3(bump,0.));
  float lit=mix(.95, .58+.52*max(dot(N,-uSunDir),0.), uSunLit);
  float noseW=min(.03,uCopW*.5);
  if(s<noseW) lit*=.7+.44*sin(s/noseW*1.5707963);
  else lit*=1.+.03*(1.-t);
  if(s>uCopW-.012) lit*=.9;                               // arête extérieure
  c*=lit;
  if(uLampN>0){
    vec3 sp=lampLight(X,-.12,vec3(0.),0.);
    c+=uCop*sp*exp(-s/.32)*.55*uLampGain;
  }
  return c; }

/* ---------- reflets ----------
   Le rayon réfléchi remonte : il peut toucher la paroi émergée d'en face, puis
   sort du bassin. Au-delà, l'environnement est la photo elle-même, posée sur
   une sphère autour du bassin : on projette le point touché dans l'image et on
   y lit la couleur. Hors de l'image, un ciel déduit du haut de la photo. */
vec3 skyEnv(vec3 R){
  float e=clamp(dot(R,vec3(0.,0.,-uDn)),0.,1.);
  return mix(uSkyHor, uSkyTop, pow(e,.55)); }
vec3 reflColor(vec3 Wp, vec3 R){
  vec3 U=vec3(0.,0.,-uDn);
  float up=dot(R,U);
  if(up<.03){ R=normalize(R+U*(.03-up)); up=dot(R,U); }
  vec3 O=Wp;
  if(uWl>0.){
    float t=uWl/up; vec2 Q=Wp.xy+R.xy*t;
    if(sdPool(Q)>=0.){
      float lo=0., hi=t;
      for(int i=0;i<10;i++){ float md=(lo+hi)*.5; if(sdPool(Wp.xy+R.xy*md)<0.) lo=md; else hi=md; }
      return dryWall(Wp.xy+R.xy*lo, lo*up)*uExpo;
    }
    O=vec3(Q,uZw);
  }
  vec3 Cp=vec3(uL*.5,uW*.5,uZw);
  float Rd=max(14., max(uL,uW)*1.6+6.);
  vec3 oc=O-Cp; float b=dot(oc,R), c=dot(oc,oc)-Rd*Rd;
  float t=-b+sqrt(max(b*b-c,0.));
  vec3 Q=O+R*t;
  vec3 sky=skyEnv(R);
  vec3 pr=proj(Q);
  if(pr.z<=0.) return sky;
  vec2 uv=pr.xy/uRes;
  float w=smoothstep(0.,.04,uv.x)*smoothstep(1.,.96,uv.x)*smoothstep(0.,.05,uv.y)*smoothstep(1.,.95,uv.y);
  if(w<=0.) return sky;
  vec3 ph=textureLod(uPhoto, clamp(uv,0.,1.), uPhotoLod).rgb*255.;
  return mix(sky, ph, w); }

/* ---------- eau ---------- */
vec3 water(vec2 X){
  float dn=uDn; vec3 U=vec3(0.,0.,-dn), D=-U;
  vec3 Wp=vec3(X,uZwat);
  vec3 V=normalize(Wp-uC);
  float dist=length(Wp-uC);
  vec3 sw3=surf(X, uWav*.055);
  vec2 mg=micro(X)*uWav*.012*clamp(1.4-dist/18.,0.,1.);
  vec3 N=normalize(vec3(-sw3.x-mg.x, -sw3.y-mg.y, -dn));
  float cosI=-dot(V,N);
  vec3 T=refract(V,N,1./1.333);
  if(dot(T,T)<.5) T=V;
  float td=T.z*dn;
  if(td<1e-4){ td=1e-4; T=vec3(T.xy, dn*1e-4); }

  float dep, tb;
  if(uHasGrid==1){
    float hx=length(T.xy), t=0.;
    for(int i=0;i<28;i++){
      float Dd=depthAt(X+T.xy*t);
      if(td*t>=Dd-1e-6) break;
      float want=Dd/td;
      t = hx>1e-6 ? min(want, t+.33/hx) : want;
    }
    float lo=max(0.,t-.33/max(hx,1e-6)), hi=t;
    for(int i=0;i<12;i++){ float md=(lo+hi)*.5; if(td*md<depthAt(X+T.xy*md)) lo=md; else hi=md; }
    tb=hi; dep=td*tb;
  } else {
    dep=depthAt(X);
    for(int i=0;i<2;i++) dep=depthAt(X+T.xy*(dep/td));
    tb=dep/td;
  }
  vec2 P=X+T.xy*tb; float path=tb, wallD=dep, hitD=dep;
  bool onWall=false, onStair=false;
  if(sdPool(P)>0.){
    float lo=0., hi=tb;
    for(int it=0;it<14;it++){ float md=(lo+hi)*.5; if(sdPool(X+T.xy*md)<0.) lo=md; else hi=md; }
    path=lo; P=X+T.xy*lo; wallD=lo*td; hitD=wallD; onWall=true;
  }
  vec3 stN=vec3(0.);
  if(uStN>0){
    float bt=1e9, bd=0.; vec3 bn=vec3(0.);
    for(int i=0;i<3;i++){ if(i>=uStN) break; partHit(getPart(i), X, T, td, dep, bt, bd, bn); }
    if(bt<path){ path=bt; hitD=bd; stN=bn; onStair=true; onWall=false; P=X+T.xy*bt; }
  }

  // support : albédo, normale (monde) et occlusion ambiante
  vec3 alb=uLiner, Nw, Nl;
  float floorHere=depthAt(P), ao=1.;
  if(onStair){
    Nl=stN; Nw=normalize(vec3(stN.xy, stN.z*dn));
    ao=1.-.22*exp(-max(floorHere-hitD,0.)/.12)*(1.-abs(stN.z));
  } else if(onWall){
    vec2 g=sdGrad(P); Nl=vec3(-g,0.); Nw=Nl;
    ao=1.-.34*exp(-max(floorHere-wallD,0.)/.2);
    if(uFrz>0 && wallD<.16) alb=frieze(P,wallD);
  } else {
    Nl=vec3(0.,0.,-1.); Nw=U;
    ao=1.-.40*exp(-max(-sdPool(P),0.)/.22);
  }
  // léger grain du gelcoat / liner
  alb*=.97+.06*vnoise(P*35.+hitD*13.);

  vec2 Q1; float tr;
  float vis=sunVis(P,hitD,Q1,tr);
  vec3 sw=sunWater();
  float ndl=max(dot(Nw,-sw),0.);
  float wavK=clamp(uWav*1.9,0.,1.3);
  vec2 cuv=Q1*.55;
  float sp=.0035*hitD;
  vec3 cau=vec3(caustic(cuv+vec2(sp,0.)), caustic(cuv), caustic(cuv-vec2(sp,0.)));
  cau=mix(cau, vec3(.2), clamp(hitD/3.5,0.,.7));
  vec3 light=vec3(.48*ao)+uSunLit*.62*vis*ndl*(.72+1.5*cau*wavK)*mix(1.,ao,.5);
  vec3 base=alb*light;

  float Lp=path+hitD;
  vec3 a=exp(-ABS*Lp);
  vec3 col=base*a+SCAT*(1.-a);

  if(uLampN>0){
    col+=uLiner*lampLight(P,hitD,Nl,path)*uLampGain;
    col+=lampGlow(X,T,td,path)*uLampGain;
  }
  col*=uExpo;

  // reflet (Fresnel) puis spéculaire du soleil
  vec3 R=reflect(V,N);
  float F=.02+.98*pow(1.-clamp(cosI,0.,1.),5.);
  F=clamp(F*mix(.35,1.45,uRefl),0.,1.);
  col=mix(col, reflColor(Wp,R), F);
  if(uSunLit>0.){
    float t2=uWl/max(dot(uSunDir,D),.05);
    float pen=.01+.03*t2;
    float sv=mix(1., 1.-smoothstep(-pen,pen,sdPool(X-uSunDir.xy*t2)), uShK);
    float d=max(dot(normalize(R),-uSunDir),0.);
    float spec=(pow(d,90.)*190.+pow(d,1200.)*1600.)*mix(.35,1.45,uRefl)*uSunLit*sv;
    col+=spec*vec3(1.,1.01,1.03);
  }
  return col; }

/* ---------- un échantillon ---------- */
vec4 shade(vec2 fp){
  vec3 Dr=rayDir(fp), rim;
  if(!hitPlane(Dr,uZw,rim)) return vec4(0.);
  vec2 X=rim.xy; float s=sdPool(X);
  if(s>=0.){
    if(s<uCopW) return vec4(coping(X,s)*uExpo, clamp((uCopW-s)/.02,0.,1.));
    if(s<uCopW+.55 && uShd>0.){
      float t=1.-(s-uCopW)/.55;
      float dirB=clamp(.55+.45*dot(X-vec2(uL,uW)*.5, uShadowDir)/max(uL,uW),0.,1.);
      float a=(t*t*.5*dirB+.28*exp(-(s-uCopW)/.035))*uShd;
      return vec4(0.,0.,0.,clamp(a,0.,1.));
    }
    return vec4(0.);
  }
  vec3 wat;
  if(!hitPlane(Dr,uZwat,wat)) return vec4(0.);
  if(sdPool(wat.xy)>=0. && uWl>0.){
    float lo=rim.z, hi=wat.z;
    for(int i=0;i<14;i++){ float md=(lo+hi)*.5; if(sdPool(uC.xy+Dr.xy*md)<0.) lo=md; else hi=md; }
    vec3 p=uC+Dr*lo;
    return vec4(dryWall(p.xy, abs(p.z-uZwat))*uExpo, 1.);
  }
  return vec4(water(wat.xy), 1.); }

float tone(float v){ const float K=196.; if(v<=K) return max(v,0.); return K+(255.-K)*(1.-exp(-(v-K)/(255.-K))); }

void main(){
  vec2 fp=vec2(gl_FragCoord.x, uRes.y-gl_FragCoord.y);
  vec4 acc=vec4(0.);
  for(int j=0;j<4;j++){ if(j>=uSS) break;
    for(int i=0;i<4;i++){ if(i>=uSS) break;
      // grille tournée : moins de crénelage sur les bords presque horizontaux
      vec2 o=(vec2(i,j)+.5)/float(uSS)-.5;
      o=vec2(o.x*.97+o.y*.24, o.y*.97-o.x*.24);
      vec4 r=shade(fp+o);
      acc+=vec4(r.rgb*r.a, r.a);
    }
  }
  acc/=float(uSS*uSS);
  if(acc.a<1e-4){ outColor=vec4(0.); return; }
  vec3 c=acc.rgb/acc.a;
  c=vec3(tone(c.r),tone(c.g),tone(c.b))*uTint;
  c=uLift+c*(1.-uLift/255.);
  c+=(hash2(floor(fp)*1.37+.5)-.5)*uGrain*2.;
  c=clamp(c,0.,255.)/255.;
  outColor=vec4(c*acc.a, acc.a); }
`;

/* ---------- programme ---------- */
function compile(type, src){
  const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
let prog;
try {
  prog=gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
} catch(e) {
  console.warn('[rendu GPU] shader refusé, moteur d\'origine conservé :', e.message);
  window.__renduGPU = {actif:false, erreur:e.message};
  return;
}
gl.useProgram(prog);
const vbo=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
const aPos=gl.getAttribLocation(prog,'aPos');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);

const locs={};
const U=n=>(n in locs)?locs[n]:(locs[n]=gl.getUniformLocation(prog,n));
const u1f=(n,v)=>gl.uniform1f(U(n),v), u1i=(n,v)=>gl.uniform1i(U(n),v);
const u2f=(n,a,b)=>gl.uniform2f(U(n),a,b), u3f=(n,v)=>gl.uniform3f(U(n),v[0],v[1],v[2]);

const texPhoto=gl.createTexture(), texGrid=gl.createTexture();
let photoKey=null, gridKey=null;
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

function uploadPhoto(src){
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texPhoto);
  if(photoKey===src) return;
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  photoKey=src;
}
function uploadGrid(g){
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texGrid);
  if(!g){
    if(gridKey!=='vide'){
      gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,1,1,0,gl.RED,gl.FLOAT,new Float32Array([1]));
      gridKey='vide';
    }
  } else if(gridKey!==g){
    gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,g.w,g.h,0,gl.RED,gl.FLOAT,g.d);
    gridKey=g;
  }
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
}

/* ---------- accord sur la photo ----------
   Mesuré une fois par photo : point noir (voile atmosphérique, compression
   JPEG), dominante de la lumière et niveau de bruit. Le rendu reprend ces trois
   défauts, à hauteur du curseur « Fondu dans la photo » : une image trop propre
   est ce qui trahit le plus vite un montage. */
let look=null, lookKey=null;
function analyse(){
  if(lookKey===photo) return look;
  const w=photo.width, h=photo.height, d=photoData;
  const hist=new Uint32Array(256);
  let n=0, sr=0, sg=0, sb=0;
  for(let y=0;y<h;y+=3) for(let x=0;x<w;x+=3){
    const i=(y*w+x)*4, r=d[i], g=d[i+1], b=d[i+2];
    hist[(r*.3+g*.59+b*.11)|0]++; n++;
    // gris de Minkowski (p=6) : estime la couleur de la lumière sans être
    // dominé par le vert de la pelouse comme une simple moyenne
    sr+=Math.pow(r/255,6); sg+=Math.pow(g/255,6); sb+=Math.pow(b/255,6);
  }
  let acc=0, p1=0;
  for(let i=0;i<256;i++){ acc+=hist[i]; if(acc>n*.01){ p1=i; break; } }
  const ill=[Math.pow(sr/n,1/6), Math.pow(sg/n,1/6), Math.pow(sb/n,1/6)];
  const m=(ill[0]+ill[1]+ill[2])/3||1;
  const tint=ill.map(v=>clamp(v/m,.9,1.1));
  // bruit : écart d'un pixel à la moyenne de ses voisins, dans les zones calmes
  let ns=0, nc=0;
  const lum=i=>d[i]*.3+d[i+1]*.59+d[i+2]*.11;
  for(let y=2;y<h-2;y+=5) for(let x=2;x<w-2;x+=5){
    const i=(y*w+x)*4, l=lum(i), a=lum(i-4), b=lum(i+4), c=lum(i-w*4), e=lum(i+w*4);
    if(Math.abs(a-b)>10||Math.abs(c-e)>10) continue;
    ns+=Math.abs(l-(a+b+c+e)/4); nc++;
  }
  const grain=nc?clamp(ns/nc*1.3,.8,7):1.6;
  look={lift:Math.min(p1,40), tint, grain};
  lookKey=photo;
  return look;
}

/* ---------- rendu ---------- */
let out2d=null;
const STRIP=160;          // rangées par appel : évite le chien de garde GPU des tablettes

function gpuRender(){
  cam=buildCam();
  stats();
  job=null;
  if(!cam){ poolCv=null; draw(); return; }
  const c=cam, L=c.L, W=c.W, shape=$('shape').value;
  roundR=+$('rr').value/100;
  for(const p of props){
    const r=PROPS[p.t].r*p.s;
    p.X=clamp(p.X, Math.min(r,L/2), Math.max(L-r,L/2));
    p.Y=clamp(p.Y, Math.min(r,W/2), Math.max(W-r,W/2));
  }
  const copW=+$('cw').value/100;
  const liner=LINERS[clamp(+$('lin').value,0,LINERS.length-1)].c;
  const cop=COPINGS[+$('cop').value];
  const wav=+$('wav').value/100, refl=+$('rfl').value/100;
  let shdA=+$('shd').value/100;
  const integ=+$('int').value/100;
  const frz=+$('frz').value;
  const sunA=+$('sun').value*Math.PI/180;
  const sunDir=nrm([Math.cos(sunA), Math.sin(sunA), 0.85*c.dn]);
  let expo=mix(1, clamp(ringLum/0.46,.65,1.5), integ);
  const night=isNight();
  const lamp=lampSetup(c,L,W);
  let skyCol=sky;
  if(night){ expo*=0.17; shdA=0; skyCol=[sky[0]*0.10+6, sky[1]*0.12+8, sky[2]*0.20+16]; }
  const skyHor=night ? skyCol.map(v=>v*1.25) : skyCol.map(v=>mix(v,238,.35));
  const stair=grid ? null : stairCfg(L,W,shape);
  const lk=analyse();

  const Wd=photo.width, Hd=photo.height;
  if(glc.width!==Wd||glc.height!==Hd){ glc.width=Wd; glc.height=Hd; }

  // emprise : bassin + margelles + ombre
  const margin=copW+0.6;
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
  for(const [sx,sy] of [[-margin,-margin],[L+margin,-margin],[L+margin,W+margin],[-margin,W+margin]]){
    const p=applyH(c.Hw,sx,sy);
    if(!isFinite(p[0])||!isFinite(p[1])||p[2]<=0){ x0=0;y0=0;x1=Wd;y1=Hd; break; }
    x0=Math.min(x0,p[0]); x1=Math.max(x1,p[0]); y0=Math.min(y0,p[1]); y1=Math.max(y1,p[1]);
  }
  x0=clamp(Math.floor(x0)-2,0,Wd); x1=clamp(Math.ceil(x1)+2,0,Wd);
  y0=clamp(Math.floor(y0)-2,0,Hd); y1=clamp(Math.ceil(y1)+2,0,Hd);

  gl.useProgram(prog);
  uploadPhoto(backdrop());
  uploadGrid(grid);
  u1i('uPhoto',0); u1i('uGrid',1);

  u2f('uRes',Wd,Hd); u1f('uF',c.f); u2f('uO',c.ox,c.oy);
  gl.uniformMatrix3fv(U('uR'),false,new Float32Array(c.R));
  u3f('uT',c.t); u3f('uC',c.C);
  u1f('uDn',c.dn); u1f('uZw',c.Zw); u1f('uZwat',c.Zwat); u1f('uWl',c.wl);
  u1f('uL',L); u1f('uW',W); u1i('uShape', shape==='oval'?2:shape==='round'?1:0); u1f('uRoundR',roundR);
  u1f('uCopW',copW); u3f('uCop',cop.c); u3f('uCopJ',cop.j); u1i('uCopTex', cop.tex==='bullee'?1:0);
  u3f('uLiner',liner); u1i('uFrz',frz);
  u1f('uWav',wav); u1f('uRefl',refl); u1f('uShd',shdA);
  u1f('uShK', night?0:clamp(shdA*1.7,0,1));
  u1f('uExpo',expo); u1f('uSunLit', night?0:1);
  u3f('uSunDir',sunDir); u2f('uShadowDir',-Math.cos(sunA),-Math.sin(sunA));
  u3f('uSkyTop',skyCol); u3f('uSkyHor',skyHor);
  u1f('uPhotoLod', .6+wav*2.2+Math.max(0,Math.log2(Math.max(Wd,Hd)/1000)));
  u1i('uHasGrid', grid?1:0);
  if(grid){ gl.uniform2i(U('uGridN'),grid.w,grid.h); u1f('uGridCell',GRID_CELL); }
  const fond=$('fond').value;
  u1i('uFond', fond==='plat'?0:fond==='pente'?1:fond==='fosse'?2:3);
  u1f('uPs',+$('dPs').value); u1f('uPd',+$('dPd').value);

  const parts=stair?stair.parts.slice(0,3):[];
  const A=new Float32Array(12), B=new Float32Array(12), C2=new Float32Array(12);
  parts.forEach((p,i)=>{
    A.set([p.side,p.SL,p.n,p.run],i*4);
    B.set([p.rise,p.w,p.radial?1:0,p.uc],i*4);
    C2.set([p.corner?1:0,p.reach,0,0],i*4);
  });
  u1i('uStN',parts.length);
  gl.uniform4fv(U('uStA[0]'),A); gl.uniform4fv(U('uStB[0]'),B); gl.uniform4fv(U('uStC[0]'),C2);

  if(lamp){
    const pos=new Float32Array(12);
    lamp.pos.slice(0,4).forEach((p,i)=>pos.set(p,i*3));
    u1i('uLampN',Math.min(4,lamp.pos.length));
    gl.uniform3fv(U('uLampPos[0]'),pos);
    u3f('uLampCol',lamp.col); u1f('uLampI',lamp.I);
  } else u1i('uLampN',0);
  u1f('uLampGain',1/Math.max(expo,1e-3));

  const k=integ;
  u3f('uTint', lk.tint.map(v=>mix(1,v,.45*k)));
  u1f('uLift', lk.lift*.85*k);
  u1f('uGrain', mix(1.6, lk.grain, k));
  u1i('uSS', interacting?1:3);
  u1f('uTime', 0);

  gl.viewport(0,0,Wd,Hd);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.SCISSOR_TEST);
  // le repère GL a son origine en bas : les rangées de la photo sont retournées
  for(let y=y0;y<y1;y+=STRIP){
    const h=Math.min(STRIP,y1-y);
    gl.scissor(x0, Hd-(y+h), x1-x0, h);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.flush();
  }
  gl.disable(gl.SCISSOR_TEST);

  if(!out2d||out2d.width!==Wd||out2d.height!==Hd){
    out2d=document.createElement('canvas'); out2d.width=Wd; out2d.height=Hd;
  }
  const o=out2d.getContext('2d');
  o.clearRect(0,0,Wd,Hd);
  o.drawImage(glc,0,0);
  poolCv=out2d;
  draw();
}

const cpuStart=startRender;
let lost=false;
glc.addEventListener('webglcontextlost', e=>{ e.preventDefault(); lost=true; console.warn('[rendu GPU] contexte perdu : retour au moteur d\'origine'); render(); });
startRender=function(){
  if(lost || window.__renduGPU.actif===false) return cpuStart();
  try{ gpuRender(); }
  catch(e){ console.error('[rendu GPU]', e); lost=true; cpuStart(); }
};
window.__renduGPU={actif:true, version:'1.0'};
if(photo&&pts) render();
})();
