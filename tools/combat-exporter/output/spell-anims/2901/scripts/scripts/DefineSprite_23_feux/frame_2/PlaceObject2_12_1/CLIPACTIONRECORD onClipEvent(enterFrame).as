onClipEvent(enterFrame){
   _rotation = random(360);
   t = 20 + random(80);
   _xscale = t;
   _yscale = t;
   _parent._y += g;
   _alpha = 150 - (va += vacc);
   _X = _X - (_X - d) / acc;
   if(_alpha < 0)
   {
      _parent.removeMovieClip();
   }
}
