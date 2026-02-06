onClipEvent(enterFrame){
   _rotation = _rotation + t / 6;
   t--;
   _xscale = t / 3;
   _yscale = t / 3;
   _parent._y += g;
   _X = _X - (_X - d) / acc;
   if(t < 0)
   {
      _parent.removeMovieClip();
   }
}
