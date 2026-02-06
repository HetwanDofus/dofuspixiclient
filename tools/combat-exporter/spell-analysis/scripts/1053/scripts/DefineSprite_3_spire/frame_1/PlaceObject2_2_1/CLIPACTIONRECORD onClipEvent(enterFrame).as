onClipEvent(enterFrame){
   _xscale = _xscale * 0.97;
   _X = _X - (v *= 0.9);
   _alpha = _alpha - va;
   if(_alpha < 0)
   {
      _parent.removeMovieClip();
   }
}
