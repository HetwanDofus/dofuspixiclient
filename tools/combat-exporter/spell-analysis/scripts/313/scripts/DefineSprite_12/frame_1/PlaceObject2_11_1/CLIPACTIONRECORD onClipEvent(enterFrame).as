onClipEvent(enterFrame){
   _alpha = _alpha - valph;
   ta -= (ta - t) / 7;
   _xscale = ta * sens;
   _yscale = ta;
   _X = _X + vx;
   _Y = _Y + vy;
   _rotation = _rotation + vr;
   vx *= 0.8;
   vy *= 0.8;
   vr *= 0.9;
}
