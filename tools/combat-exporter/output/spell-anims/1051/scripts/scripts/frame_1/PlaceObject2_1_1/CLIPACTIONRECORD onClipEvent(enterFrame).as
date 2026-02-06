onClipEvent(enterFrame){
   _alpha = -20 + random(80);
   t = 10 * Math.random() + 90;
   _xscale = t;
   _yscale = t;
   _rotation = random(360);
}
