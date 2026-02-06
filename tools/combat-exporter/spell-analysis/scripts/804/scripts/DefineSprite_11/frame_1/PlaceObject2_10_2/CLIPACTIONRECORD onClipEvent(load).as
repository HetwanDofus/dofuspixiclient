onClipEvent(load){
   gotoAndPlay(random(30) + 1);
   ta = _parent._parent.ta;
   r = Math.random() * ta;
   v = 1.66 * r;
   _alpha = 360;
}
