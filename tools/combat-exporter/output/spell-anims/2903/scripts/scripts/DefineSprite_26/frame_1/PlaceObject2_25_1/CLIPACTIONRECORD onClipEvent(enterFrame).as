onClipEvent(enterFrame){
   if(random(2) == 1)
   {
      _rotation = _rotation + 100;
      _parent._parent.attachMovie("minifeux","minifeux" + c,c);
      c++;
   }
}
