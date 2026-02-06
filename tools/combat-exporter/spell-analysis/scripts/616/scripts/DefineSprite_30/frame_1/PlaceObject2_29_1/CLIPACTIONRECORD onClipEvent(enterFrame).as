onClipEvent(enterFrame){
   _alpha = _alpha - 2.5;
   if(_Y < _parent.p)
   {
      vrot2 /= 1.12;
      _xscale = 50 * Math.sin(i += vrot2);
      _rotation = _rotation + vrot;
   }
}
